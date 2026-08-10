import { createFlueClient, FlueApiError, FlueExecutionError } from "@flue/sdk";

import {
  automationGenerationAgentResultSchema,
  type AutomationGenerationAgentResult,
  type AutomationGenerationCatalog,
  type AutomationGenerationContinuation,
  type AutomationGenerationResult,
  type AutomationResourceRequest,
  type GenerateAutomationInput,
  validateAutomation,
} from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase, uuidv7 } from "@openengage/database";

import type { RuntimeEnv } from "../env";
import { normalizeGeneratedAutomation } from "./generation-normalizer";
import {
  loadAutomationResourceContext,
  optionsForResourceKind,
  validateAutomationResources,
} from "./resource-validation";

const GENERATION_TIMEOUT_MS = 60_000;
const PROPOSAL_PART_NAME = "proposal";

export type AutomationGenerationFailure = "failed" | "timeout" | "unavailable";

export class AutomationGenerationError extends Error {
  public constructor(
    public readonly kind: AutomationGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`Automation generation ${kind}`, options);
    this.name = "AutomationGenerationError";
  }
}

export async function generateAutomation(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateAutomationInput,
  trustedBrief?: unknown,
): Promise<AutomationGenerationResult> {
  const resources = await loadAutomationResourceContext(database, workspace);
  const unresolved = unresolvedContinuation(input, resources.catalog);
  if (unresolved) return unresolved;

  const proposal = await requestAutomationProposal(env, input, resources.catalog, trustedBrief);
  if (proposal.status === "needs_input") {
    return needsInputResult(
      {
        summary: proposal.summary,
        plannedSteps: proposal.plannedSteps,
        resources: proposal.resources,
      },
      resources.catalog,
    );
  }

  const graphIssues = validateAutomation(proposal.definition);
  if (graphIssues.length > 0) {
    throw new AutomationGenerationError("failed", {
      cause: new Error(graphIssues.map((issue) => issue.message).join("; ")),
    });
  }
  const resourceIssues = validateAutomationResources(proposal.definition, resources);
  if (resourceIssues.length > 0) {
    throw new AutomationGenerationError("failed", {
      cause: new Error(resourceIssues.map((issue) => issue.message).join("; ")),
    });
  }

  const definition = normalizeGeneratedAutomation(
    proposal.definition,
    input.mode === "refine" ? input.currentDefinition : undefined,
    uuidv7,
  );
  return { ...proposal, definition };
}

async function requestAutomationProposal(
  env: RuntimeEnv,
  request: GenerateAutomationInput,
  catalog: AutomationGenerationCatalog,
  trustedBrief?: unknown,
): Promise<AutomationGenerationAgentResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    GENERATION_TIMEOUT_MS,
  );
  const conversation = createFlueClient({
    url: `https://agent.internal/internal/automation-designer/${uuidv7()}`,
    fetch: (input, init) => env.AGENT_APP.fetch(new Request(input, init)),
  });

  try {
    const admission = await conversation.send({
      message: { kind: "user", body: request.prompt },
      initialData: { request, catalog, ...(trustedBrief ? { trustedBrief } : {}) },
      uid: null,
      signal: controller.signal,
    });
    const reply = await conversation.read(admission, { signal: controller.signal });
    const proposalParts = reply.data[PROPOSAL_PART_NAME] ?? [];
    const proposal = proposalParts.at(-1);
    const parsed = automationGenerationAgentResultSchema.safeParse(proposal);
    if (!parsed.success) {
      throw new AutomationGenerationError("failed", { cause: parsed.error });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AutomationGenerationError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      await conversation.abort().catch(() => undefined);
      throw new AutomationGenerationError("timeout", { cause: error });
    }
    if (error instanceof FlueApiError) {
      throw new AutomationGenerationError("unavailable", { cause: error });
    }
    if (error instanceof FlueExecutionError) {
      throw new AutomationGenerationError("failed", { cause: error });
    }
    throw new AutomationGenerationError("unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function unresolvedContinuation(
  input: GenerateAutomationInput,
  catalog: AutomationGenerationCatalog,
): AutomationGenerationResult | null {
  if (!input.continuation) return null;
  const resolutions = new Map(input.resolutions?.map((item) => [item.requestId, item]) ?? []);
  const unresolved = input.continuation.resources.filter((request) => {
    const resolution = resolutions.get(request.requestId);
    if (!resolution) return true;
    if (resolution.decision === "omit") return !request.canOmit;
    return !optionsForResourceKind(catalog, request.kind).some(
      (option) => option.id === resolution.resourceId,
    );
  });
  if (unresolved.length === 0) return null;
  return needsInputResult(input.continuation, catalog);
}

function needsInputResult(
  continuation: AutomationGenerationContinuation,
  catalog: AutomationGenerationCatalog,
): AutomationGenerationResult {
  assertUniqueRequests(continuation.resources);
  return {
    status: "needs_input",
    summary: continuation.summary,
    plannedSteps: continuation.plannedSteps,
    continuation,
    resources: continuation.resources.map((request) => ({
      ...request,
      options: optionsForResourceKind(catalog, request.kind),
    })),
  };
}

function assertUniqueRequests(requests: AutomationResourceRequest[]): void {
  const ids = new Set<string>();
  for (const request of requests) {
    if (ids.has(request.requestId)) {
      throw new AutomationGenerationError("failed", {
        cause: new Error(`Duplicate resource request: ${request.requestId}`),
      });
    }
    ids.add(request.requestId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
