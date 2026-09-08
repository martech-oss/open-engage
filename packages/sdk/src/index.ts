import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

import { contract } from "@openengage/orpc";

/**
 * The SDK is generated from the same oRPC contract that serves /api/rpc and
 * /api/v1, so request/response types can never drift from the server.
 * Calls go through the public OpenAPI surface at /api/v1.
 */
export interface OpenEngageClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export type OpenEngageClient = ContractRouterClient<typeof contract>;

export function createOpenEngageClient(options: OpenEngageClientOptions): OpenEngageClient {
  const link = new OpenAPILink(contract, {
    url: new URL("/api/v1", options.baseUrl).toString(),
    headers: { authorization: `Bearer ${options.apiKey}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createORPCClient(link);
}

// Error helpers for consumers: every declared contract error surfaces as a
// typed ORPCError with `defined: true` and its contract code.
export { isDefinedError, ORPCError, safe } from "@orpc/client";

// Contract value/type re-exports so SDK consumers need only this package.
export { contract } from "@openengage/orpc";
export type { AssetSummary } from "@openengage/core/assets";
export type {
  AutomationAudience,
  AutomationDefinition,
  AutomationDependency,
  AutomationDraft,
  AutomationEdge,
  AutomationExecutionSnapshot,
  AutomationNode,
  AutomationRow,
  AutomationRun,
  AutomationSchedule,
} from "@openengage/core/automations";

// Response-only types derive from the contract when core exposes only a schema.
export type AutomationRunDetail = Awaited<ReturnType<OpenEngageClient["automations"]["runDetail"]>>;
export type AutomationRunTarget = AutomationRunDetail["targets"][number];
export type AutomationEnrollmentDetail = Awaited<
  ReturnType<OpenEngageClient["automations"]["enrollmentDetail"]>
>;
export type AutomationRunPreview = Awaited<
  ReturnType<OpenEngageClient["automations"]["previewRun"]>
>;
export type {
  ContactListInput,
  ContactListResult,
  ContactDataJob,
  ContactSummary,
  ContactTimelineEvent,
} from "@openengage/core/contacts";
export type { Dashboard } from "@openengage/core/reports";
export type {
  ScoringPageInput,
  ScoringRule,
  ScoringRulePage,
  GradingCriterion,
  GradingCriterionPage,
} from "@openengage/core/scoring";
export type { DeadLetterRow } from "@openengage/core/platform";
export type { SegmentRow } from "@openengage/core/segments";
export type { SubscriptionTopicRow } from "@openengage/core/consent";
export type {
  ApprovedMarketingBriefContext,
  MarketingAutomationBriefDefinition,
  MarketingBriefGenerationResult,
  MarketingCapability,
  MarketingCapabilitySnapshot,
  MarketingCapabilityState,
  MarketingMotion,
  ProjectBriefAllowedActions,
  ProjectBriefDetail,
  ProjectBriefDocument,
  ProjectBriefDocumentV1,
  ProjectBriefDraftInput,
  ProjectBriefAuditEvent,
  ProjectBriefMutation,
  ProjectBriefReference,
  ProjectBriefReview,
  ProjectBriefStatus,
  ProjectBriefSummary,
  ProjectLinkedResource,
  ProjectResourceAvailability,
  ProjectRow,
  ProgramBinding,
  ProgramBindingIntent,
  ProgramCohortInput,
  ProgramMemberMutation,
  ProgramMemberMutationResult,
  ProjectCloneJob,
  ProjectCloneOptions,
  ProjectClonePreview,
  ProjectCloneReferenceMap,
  ProjectCloneResource,
  ProjectCloneResourceKind,
  ProjectMember,
  ProjectMemberSource,
  ProjectMemberTransition,
  ProjectProgram,
  ProjectProgramDefinition,
  ProjectProgramDetail,
  ProjectProgramStatus,
  VariableDefinition,
  VariableImpactInput,
  VariableRef,
  VariableSnapshot,
  VariableType,
  VariableUsage,
  VariableWrite,
} from "@openengage/core/projects";
export type ProgramCohort = Awaited<ReturnType<OpenEngageClient["projects"]["programCohort"]>>;
export type ProjectMemberList = Awaited<ReturnType<OpenEngageClient["projects"]["memberList"]>>;
export type VariableImpact = Awaited<
  ReturnType<OpenEngageClient["projects"]["variablesImpact"]>
>[number];
export type { WebhookEndpointRow } from "@openengage/core/workspaces";

export type ProgramMemberImportJob = Awaited<
  ReturnType<OpenEngageClient["projects"]["memberImportGet"]>
>;

export type {
  ProjectCloneSummary,
  ProjectCloneCursor,
  ProjectClonePage,
} from "@openengage/core/projects";
