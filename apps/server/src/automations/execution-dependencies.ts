import type {
  AutomationActionRepository,
  AutomationCallRepository,
  AutomationContactActionRepository,
  AutomationDecisionRepository,
  AutomationJobRecoveryRepository,
  AutomationJobRepository,
  AutomationJobRow,
} from "@openengage/database/automations";

import type { AutomationAction } from "./action-dispatch";

type ActionOf<Kind extends AutomationAction["action"]> = Extract<
  AutomationAction,
  { action: Kind }
>;

/** Cross-domain effects are composed by runtime; execution only supplies action authority. */
export interface AutomationActionEffects {
  upsertProjectMember(
    action: ActionOf<"upsert_project_member">,
    job: AutomationJobRow,
    leaseId: string,
  ): Promise<void>;
  handoffToSales(
    action: ActionOf<"handoff_to_sales">,
    job: AutomationJobRow,
    leaseId: string,
  ): Promise<void>;
  createEmailDelivery(
    action: ActionOf<"send_email">,
    job: AutomationJobRow,
    leaseId: string,
  ): Promise<void>;
  createWebhookDelivery(endpointId: string, job: AutomationJobRow, leaseId: string): Promise<void>;
  recordSegmentJoined(job: AutomationJobRow, segmentId: string): Promise<void>;
  reconcileContact(workspaceId: string, contactId: string): Promise<void>;
}

export interface AutomationActionDependencies {
  actionRepository: Pick<
    AutomationActionRepository,
    "adjustContactScoreForJob" | "hasRunningLease"
  >;
  contactActions: Pick<
    AutomationContactActionRepository,
    | "addContactTag"
    | "removeContactTag"
    | "addAutomationSegmentMembership"
    | "removeSegmentMembership"
    | "updateContactColumn"
    | "replaceContactCustomFields"
  >;
  effects: AutomationActionEffects;
  clock: () => Date;
}

export interface AutomationNodeDependencies {
  decisions: Pick<AutomationDecisionRepository, "captureCondition" | "hasContactEventSince">;
  contactConditions: Pick<AutomationContactActionRepository, "contactHasTagWithSlug">;
  calls: Pick<AutomationCallRepository, "startChild">;
  executeAction(action: AutomationAction, job: AutomationJobRow, leaseId: string): Promise<void>;
  clock: () => Date;
}

export interface AutomationWorkerDependencies {
  jobs: Pick<
    AutomationJobRepository,
    | "findJobForProcessing"
    | "startLeasedJob"
    | "parkJobUntil"
    | "completeJobClosingEnrollment"
    | "completeJobAdvancingEnrollment"
  >;
  recovery: Pick<
    AutomationJobRecoveryRepository,
    "failJobAndEnrollmentForLease" | "recordJobFailure"
  >;
  nodes: AutomationNodeDependencies;
  clock: () => Date;
}
