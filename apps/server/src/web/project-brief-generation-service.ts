import { createFlueClient, FlueApiError, FlueExecutionError } from "@flue/sdk";

import {
  marketingBriefGenerationResultSchema,
  type GenerateMarketingBriefInput,
  type MarketingBriefGenerationResult,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase, uuidv7 } from "@openengage/database";

import { loadAutomationResourceContext } from "../automations/resource-validation";
import type { RuntimeEnv } from "../env";
import { loadSegmentCatalog } from "../segments/validation-service";

const GENERATION_TIMEOUT_MS = 60_000;
const PROPOSAL_PART_NAME = "proposal";

export type MarketingBriefGenerationFailure = "failed" | "timeout" | "unavailable";

export class MarketingBriefGenerationError extends Error {
  public constructor(
    public readonly kind: MarketingBriefGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`Marketing brief generation ${kind}`, options);
    this.name = "MarketingBriefGenerationError";
  }
}

export async function generateMarketingBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateMarketingBriefInput,
): Promise<MarketingBriefGenerationResult> {
  const [resources, segmentCatalog] = await Promise.all([
    loadAutomationResourceContext(database, workspace),
    loadSegmentCatalog(database, workspace),
  ]);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    GENERATION_TIMEOUT_MS,
  );
  const conversation = createFlueClient({
    url: `https://agent.internal/internal/marketing-automation-designer/${uuidv7()}`,
    fetch: (request, init) => env.AGENT_APP.fetch(new Request(request, init)),
  });
  try {
    const admission = await conversation.send({
      message: { kind: "user", body: input.prompt },
      initialData: {
        request: input,
        now: new Date().toISOString(),
        catalog: resources.catalog,
        segmentCatalog,
        capabilities: {
          marketingEmailDelivery: false,
          emailOpenTracking: false,
          emailClickTracking: false,
          ga4Integration: false,
        },
      },
      uid: null,
      signal: controller.signal,
    });
    const reply = await conversation.read(admission, { signal: controller.signal });
    const proposal = reply.data[PROPOSAL_PART_NAME]?.at(-1);
    const parsed = marketingBriefGenerationResultSchema.safeParse(proposal);
    if (!parsed.success) throw new MarketingBriefGenerationError("failed", { cause: parsed.error });
    return parsed.data;
  } catch (error) {
    if (error instanceof MarketingBriefGenerationError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      await conversation.abort().catch(() => undefined);
      throw new MarketingBriefGenerationError("timeout", { cause: error });
    }
    if (error instanceof FlueApiError) {
      throw new MarketingBriefGenerationError("unavailable", { cause: error });
    }
    if (error instanceof FlueExecutionError) {
      throw new MarketingBriefGenerationError("failed", { cause: error });
    }
    throw new MarketingBriefGenerationError("unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
