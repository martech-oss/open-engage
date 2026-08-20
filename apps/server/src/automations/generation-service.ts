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
import type { ApprovedMarketingBriefContext } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { uuidv7 } from "@openengage/database/shared";

import { loadMarketingAgentContext } from "../agents/marketing-context";
import { AgentProposalError, requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";
import { normalizeGeneratedAutomation } from "./generation-normalizer";
import {
  loadAutomationResourceContext,
  optionsForResourceKind,
  validateAutomationResources,
} from "./resource-validation";

const GENERATION_TIMEOUT_MS = 60_000;

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
  trustedBrief?: ApprovedMarketingBriefContext,
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
  trustedBrief?: ApprovedMarketingBriefContext,
): Promise<AutomationGenerationAgentResult> {
  try {
    return await requestAgentProposal({
      env,
      agent: "automation-designer",
      prompt: request.prompt,
      initialData: { request, catalog, ...loadMarketingAgentContext(trustedBrief) },
      schema: automationGenerationAgentResultSchema,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof AgentProposalError) {
      throw new AutomationGenerationError(error.kind, { cause: error });
    }
    throw error;
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
