import {
  AUTOMATION_RESOURCE_KINDS,
  type AutomationGenerationCatalog,
  type AutomationResourceKind,
  capabilityForSequence,
  emailSequenceAgentResultSchema,
  type EmailSequenceContinuation,
  type EmailSequenceGenerationResult,
  type EmailSequenceInputRequest,
  type EmailSequenceProposal,
  type GenerateEmailSequenceInput,
  validateEmailSequenceProposal,
} from "@openengage/core/automations";
import type { ApprovedMarketingBriefContext } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  EmailSequenceDraftConflictError,
  EmailSequenceDraftRepository,
} from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { EmailDesignRepository, MessagingRepository } from "@openengage/database/messaging";
import { uuidv7 } from "@openengage/database/shared";

import { loadMarketingAgentContext } from "../agents/marketing-context";
import { AgentProposalError, requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";
import { collectEmailAssetIds } from "../messaging/email-template-service";
import {
  loadAutomationResourceContext,
  optionsForResourceKind,
  validateAutomationResources,
} from "./resource-validation";

const GENERATION_TIMEOUT_MS = 90_000;
const MAX_PROPOSAL_BYTES = 512 * 1_024;
const MESSAGE_VARIABLE_PATTERN = /\{\{\s*message\.([A-Za-z0-9_.-]{1,191})\s*\}\}/g;

export type EmailSequenceFailure = "failed" | "timeout" | "unavailable" | "conflict";

export class EmailSequenceError extends Error {
  public constructor(
    public readonly kind: EmailSequenceFailure,
    options?: ErrorOptions,
  ) {
    super(`Email sequence operation ${kind}`, options);
    this.name = "EmailSequenceError";
  }
}

export async function generateEmailSequence(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateEmailSequenceInput,
  trustedBrief?: ApprovedMarketingBriefContext,
): Promise<EmailSequenceGenerationResult> {
  const context = await loadSequenceContext(database, workspace);
  const unresolved = unresolvedContinuation(input, context.automation.catalog);
  if (unresolved) return unresolved;
  const reserved = reservedIds(input);
  const result = await requestSequenceProposal(env, {
    request: input,
    ...loadMarketingAgentContext(trustedBrief),
    catalog: context.automation.catalog,
    brand: context.brand,
    variables: context.variables,
    publicImages: context.publicImages,
    reserved,
  });
  if (result.status === "needs_input") {
    return needsInputResult(
      {
        summary: result.summary,
        plannedSteps: result.plannedSteps,
        requests: result.requests,
      },
      context.automation.catalog,
    );
  }
  validateReadyProposal(result.proposal, reserved, context);
  return { status: "ready", proposal: result.proposal };
}

export async function applyEmailSequence(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  proposal: EmailSequenceProposal,
  projectLink?: { projectId: string; briefRevision: number; addedByUserId: string },
) {
  const context = await loadSequenceContext(database, workspace);
  validateReadyProposal(proposal, null, context);
  const repository = new EmailSequenceDraftRepository(database, workspace);
  try {
    return await repository.applyWithOutcome(proposal, projectLink);
  } catch (cause) {
    if (cause instanceof EmailSequenceDraftConflictError) {
      throw new EmailSequenceError("conflict", { cause });
    }
    throw cause;
  }
}

async function loadSequenceContext(database: OpenEngageDatabase, workspace: WorkspaceContext) {
  const design = new EmailDesignRepository(database, workspace);
  const [automation, brand, publicImages, variables] = await Promise.all([
    loadAutomationResourceContext(database, workspace),
    design.getBrandProfile(),
    design.listAiImageCatalog(),
    new MessagingRepository(database, workspace).listMessageVariables(false),
  ]);
  return {
    automation,
    brand,
    publicImages,
    variables: variables.map(({ key, name, description }) => ({ key, name, description })),
  };
}

type SequenceContext = Awaited<ReturnType<typeof loadSequenceContext>>;

function reservedIds(input: GenerateEmailSequenceInput): {
  proposalId: string;
  automationId: string;
  templateIds: string[];
} {
  if (input.mode === "create") {
    return {
      proposalId: uuidv7(),
      automationId: uuidv7(),
      templateIds: Array.from({ length: 8 }, () => uuidv7()),
    };
  }
  const existing = input.currentProposal.emails.map((email) => email.templateId);
  return {
    proposalId: input.currentProposal.proposalId,
    automationId: input.currentProposal.automationId,
    templateIds: [...existing, ...Array.from({ length: 8 - existing.length }, () => uuidv7())],
  };
}

function validateReadyProposal(
  proposal: EmailSequenceProposal,
  reserved: ReturnType<typeof reservedIds> | null,
  context: SequenceContext,
): void {
  if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > MAX_PROPOSAL_BYTES) {
    fail("Proposal exceeds 512 KiB");
  }
  const issues = validateEmailSequenceProposal(proposal);
  if (issues.length > 0) fail(issues.map((issue) => issue.message).join("; "));
  if (capabilityForSequence(proposal.emails) !== proposal.capabilityState) {
    fail("Capability state mismatch");
  }
  if (reserved) {
    const allowed = new Set(reserved.templateIds);
    if (
      proposal.proposalId !== reserved.proposalId ||
      proposal.automationId !== reserved.automationId ||
      proposal.emails.some((email) => !allowed.has(email.templateId))
    ) {
      fail("Proposal uses ids outside the reserved bundle");
    }
  }
  const resourceIssues = validateAutomationResources(proposal.definition, context.automation, {
    additionalEmailTemplateIds: proposal.emails.map((email) => email.templateId),
  });
  if (resourceIssues.length > 0) {
    fail(resourceIssues.map((issue) => issue.message).join("; "));
  }
  const allowedAssets = new Set(context.publicImages.map((image) => image.id));
  const allowedVariables = new Set(context.variables.map((variable) => variable.key));
  for (const email of proposal.emails) {
    for (const assetId of collectEmailAssetIds(email.content)) {
      if (!allowedAssets.has(assetId)) fail(`Unknown email asset: ${assetId}`);
    }
    const serialized = JSON.stringify(email.content);
    for (const match of serialized.matchAll(MESSAGE_VARIABLE_PATTERN)) {
      const key = match[1];
      if (key && !allowedVariables.has(key)) fail(`Unknown message variable: ${key}`);
    }
  }
}

async function requestSequenceProposal(
  env: RuntimeEnv,
  initialData: {
    request: GenerateEmailSequenceInput;
    trustedBrief?: ApprovedMarketingBriefContext;
    catalog: AutomationGenerationCatalog;
    brand: SequenceContext["brand"];
    variables: SequenceContext["variables"];
    publicImages: SequenceContext["publicImages"];
    reserved: ReturnType<typeof reservedIds>;
  },
) {
  try {
    return await requestAgentProposal({
      env,
      agent: "email-sequence-designer",
      prompt: initialData.request.prompt,
      initialData,
      schema: emailSequenceAgentResultSchema,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof AgentProposalError) {
      throw new EmailSequenceError(error.kind, { cause: error });
    }
    throw error;
  }
}

function unresolvedContinuation(
  input: GenerateEmailSequenceInput,
  catalog: AutomationGenerationCatalog,
): EmailSequenceGenerationResult | null {
  if (!input.continuation) return null;
  const resolutions = new Map(input.resolutions?.map((item) => [item.requestId, item]) ?? []);
  const unresolved = input.continuation.requests.filter((request) => {
    const resolution = resolutions.get(request.requestId);
    if (!resolution) return true;
    if (resolution.decision === "omit") return request.required;
    if (request.inputType === "text") return resolution.decision !== "provide";
    if (resolution.decision !== "select" || !isResourceKind(request.kind)) return true;
    return !optionsForResourceKind(catalog, request.kind).some(
      (option) => option.id === resolution.resourceId,
    );
  });
  return unresolved.length === 0 ? null : needsInputResult(input.continuation, catalog);
}

function needsInputResult(
  continuation: EmailSequenceContinuation,
  catalog: AutomationGenerationCatalog,
): EmailSequenceGenerationResult {
  assertUniqueRequests(continuation.requests);
  return {
    status: "needs_input",
    summary: continuation.summary,
    plannedSteps: continuation.plannedSteps,
    continuation,
    requests: continuation.requests.map((request) => ({
      ...request,
      options:
        request.inputType === "resource" && isResourceKind(request.kind)
          ? optionsForResourceKind(catalog, request.kind)
          : [],
    })),
  };
}

function assertUniqueRequests(requests: EmailSequenceInputRequest[]): void {
  const ids = new Set<string>();
  for (const request of requests) {
    if (ids.has(request.requestId)) fail(`Duplicate request id: ${request.requestId}`);
    ids.add(request.requestId);
  }
}

function isResourceKind(value: string): value is AutomationResourceKind {
  return (AUTOMATION_RESOURCE_KINDS as readonly string[]).includes(value);
}

function fail(message: string): never {
  throw new EmailSequenceError("failed", { cause: new Error(message) });
}
