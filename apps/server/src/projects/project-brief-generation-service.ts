import { validateMarketingBriefGenerationResult } from "@openengage/core/agents";
import {
  marketingBriefGenerationResultSchema,
  type GenerateMarketingBriefInput,
  type MarketingBriefGenerationResult,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { loadMarketingCapabilitySnapshot } from "../agents/marketing-context";
import { AgentProposalError, requestAgentProposal } from "../agents/proposal-client";
import { loadAutomationResourceContext } from "../automations/resource-validation";
import type { RuntimeEnv } from "../env";
import { loadSegmentCatalog } from "../segments/validation-service";

const GENERATION_TIMEOUT_MS = 60_000;

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
  const initialData = {
    request: input,
    now: new Date().toISOString(),
    catalog: resources.catalog,
    segmentCatalog,
    capabilities: loadMarketingCapabilitySnapshot(),
  };
  try {
    const result = await requestAgentProposal({
      env,
      agent: "marketing-automation-designer",
      prompt: input.prompt,
      initialData,
      schema: marketingBriefGenerationResultSchema,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    const issues = validateMarketingBriefGenerationResult(result, input, segmentCatalog);
    if (issues.length > 0) {
      throw new MarketingBriefGenerationError("failed", {
        cause: new Error(issues.join("; ")),
      });
    }
    return result;
  } catch (error) {
    if (error instanceof MarketingBriefGenerationError) throw error;
    if (error instanceof AgentProposalError) {
      throw new MarketingBriefGenerationError(error.kind, { cause: error });
    }
    throw error;
  }
}
