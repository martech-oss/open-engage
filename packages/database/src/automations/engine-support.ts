import type { AutomationDefinition } from "@openengage/core/automations";
import { assertJobTransition, type JobStatus } from "@openengage/core/platform";
import type { JsonRecord } from "@openengage/core/shared";

/** automation_jobs.status vocabulary (mirrors the table CHECK constraint). */
export type AutomationJobStatus =
  | "pending"
  | "leased"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

const MACHINE_STATUS = {
  pending: "pending",
  leased: "leased",
  queued: "queued",
  running: "processing",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<AutomationJobStatus, JobStatus>;

const COLLAPSED_HOPS: Partial<Record<`${JobStatus}->${JobStatus}`, readonly JobStatus[]>> = {
  "leased->processing": ["queued"],
  "processing->leased": ["pending"],
};

/** Validates every shared-state-machine hop represented by one database transition. */
export function assertAutomationJobTransition(
  from: AutomationJobStatus,
  to: AutomationJobStatus,
): void {
  const source = MACHINE_STATUS[from];
  const target = MACHINE_STATUS[to];
  const path: readonly JobStatus[] = [
    source,
    ...(COLLAPSED_HOPS[`${source}->${target}`] ?? []),
    target,
  ];
  for (let index = 0; index + 1 < path.length; index += 1) {
    assertJobTransition(path[index] as JobStatus, path[index + 1] as JobStatus);
  }
}

/** One executable job with the graph, enrollment and contact data required by the worker. */
export interface AutomationJobRow {
  id: string;
  workspaceId: string;
  enrollmentId: string;
  automationVersionId: string;
  nodeId: string;
  contactId: string;
  idempotencyKey: string;
  payload: JsonRecord;
  status: string;
  leaseId: string | null;
  attempts: number;
  createdAt: string;
  enteredAt: string;
  graph: AutomationDefinition;
  contactEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  stage: string;
  score: number;
  customFields: JsonRecord;
}

export const AUTOMATION_CONTACT_COLUMNS = {
  first_name: "firstName",
  last_name: "lastName",
  phone: "phone",
  stage: "stage",
  external_id: "externalId",
} as const;

export type AutomationContactColumn = keyof typeof AUTOMATION_CONTACT_COLUMNS;
