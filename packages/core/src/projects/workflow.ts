import * as z from "zod";

import { workspaceRoleSchema, type WorkspaceRole } from "../shared/schema.js";
import { marketingAutomationBriefDefinitionSchema, marketingMotionSchema } from "./definition.js";

export const PROJECT_BRIEF_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "completed",
] as const;
export const projectBriefStatusSchema = z.enum(PROJECT_BRIEF_STATUSES);
export type ProjectBriefStatus = z.infer<typeof projectBriefStatusSchema>;

export const PROJECT_BRIEF_TRANSITIONS = {
  edit: { from: ["draft"], to: "draft" },
  submit: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "approved" },
  reject: { from: ["pending_approval"], to: "draft" },
  withdraw: { from: ["pending_approval"], to: "draft" },
  reopen: { from: ["approved", "completed"], to: "draft" },
  complete: { from: ["approved"], to: "completed" },
} as const satisfies Record<
  string,
  { from: readonly ProjectBriefStatus[]; to: ProjectBriefStatus }
>;
export type ProjectBriefTransitionAction = keyof typeof PROJECT_BRIEF_TRANSITIONS;

export function canProjectBriefTransition(
  action: ProjectBriefTransitionAction,
  status: ProjectBriefStatus,
): boolean {
  return (PROJECT_BRIEF_TRANSITIONS[action].from as readonly ProjectBriefStatus[]).includes(status);
}

const projectBriefReferencePresentSchema = z.object({
  projectId: z.string().min(1),
  briefRevision: z.number().int().positive(),
});

const projectBriefReferenceAbsentSchema = z.object({
  projectId: z.undefined().optional(),
  briefRevision: z.undefined().optional(),
});

/** A resource generation request either names an exact approved revision or no brief at all. */
export const projectBriefReferenceSchema = z.union([
  projectBriefReferencePresentSchema,
  projectBriefReferenceAbsentSchema,
]);
export type ProjectBriefReference = z.infer<typeof projectBriefReferenceSchema>;

export const approvedMarketingBriefContextSchema = z
  .object({
    projectId: z.string().min(1),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(191),
    primaryMotion: marketingMotionSchema,
    definition: marketingAutomationBriefDefinitionSchema,
  })
  .strict();
export type ApprovedMarketingBriefContext = z.infer<typeof approvedMarketingBriefContextSchema>;

export const MARKETING_CAPABILITY_STATES = ["unavailable", "available", "configured"] as const;
export const marketingCapabilityStateSchema = z.enum(MARKETING_CAPABILITY_STATES);
export type MarketingCapabilityState = z.infer<typeof marketingCapabilityStateSchema>;

export const marketingCapabilitySchema = z
  .object({
    state: marketingCapabilityStateSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type MarketingCapability = z.infer<typeof marketingCapabilitySchema>;

export const marketingCapabilitySnapshotSchema = z
  .object({
    marketingEmailDelivery: marketingCapabilitySchema,
    emailOpenTracking: marketingCapabilitySchema,
    emailClickTracking: marketingCapabilitySchema,
    ga4Integration: marketingCapabilitySchema,
  })
  .strict();
export type MarketingCapabilitySnapshot = z.infer<typeof marketingCapabilitySnapshotSchema>;

export const DEFAULT_MARKETING_CAPABILITY_SNAPSHOT: MarketingCapabilitySnapshot = {
  marketingEmailDelivery: {
    state: "unavailable",
    reason: "Marketingメールの公開・配信はまだ利用できません",
  },
  emailOpenTracking: {
    state: "unavailable",
    reason: "Marketingメールの開封イベント取得はまだ利用できません",
  },
  emailClickTracking: {
    state: "unavailable",
    reason: "Marketingメールのクリックイベント取得はまだ利用できません",
  },
  ga4Integration: {
    state: "unavailable",
    reason: "GA4との連携はまだ利用できません",
  },
};

export const projectBriefAllowedActionsSchema = z.object({
  edit: z.boolean(),
  submit: z.boolean(),
  approve: z.boolean(),
  reject: z.boolean(),
  withdraw: z.boolean(),
  reopen: z.boolean(),
  complete: z.boolean(),
  archive: z.boolean(),
  addResource: z.boolean(),
  removeResource: z.boolean(),
});
export type ProjectBriefAllowedActions = z.infer<typeof projectBriefAllowedActionsSchema>;

export const projectBriefActorSchema = z.object({
  userId: z.string().min(1),
  role: workspaceRoleSchema,
});
export type ProjectBriefActor = z.infer<typeof projectBriefActorSchema>;

export interface ProjectBriefAuthorizationState {
  status: ProjectBriefStatus;
  ownerUserId: string;
  approverUserId: string;
}

export function resolveProjectBriefAllowedActions(
  brief: ProjectBriefAuthorizationState,
  actor: { userId: string; role: WorkspaceRole },
): ProjectBriefAllowedActions {
  const isMarketingMember = ["owner", "admin", "marketer"].includes(actor.role);
  const isAssignedOwner = isMarketingMember && brief.ownerUserId === actor.userId;
  const isAssignedApprover = isMarketingMember && brief.approverUserId === actor.userId;
  const isAdministrator = actor.role === "owner" || actor.role === "admin";
  const canManageApprovedResources =
    brief.status === "approved" && (isAssignedOwner || isAdministrator);

  return {
    edit: canProjectBriefTransition("edit", brief.status) && isAssignedOwner,
    submit: canProjectBriefTransition("submit", brief.status) && isAssignedOwner,
    approve: canProjectBriefTransition("approve", brief.status) && isAssignedApprover,
    reject: canProjectBriefTransition("reject", brief.status) && isAssignedApprover,
    withdraw:
      canProjectBriefTransition("withdraw", brief.status) && (isAssignedOwner || isAdministrator),
    reopen:
      canProjectBriefTransition("reopen", brief.status) && (isAssignedOwner || isAdministrator),
    complete:
      canProjectBriefTransition("complete", brief.status) && (isAssignedOwner || isAdministrator),
    archive: isAdministrator,
    addResource: canManageApprovedResources,
    removeResource: canManageApprovedResources,
  };
}
