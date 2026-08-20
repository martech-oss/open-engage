import { AutomationEngineRepository, AutomationRepository } from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";

export interface ContactEvent {
  id: string;
  workspaceId: string;
  contactId: string;
  type: string;
  resourceId?: string | null;
}

interface AutomationTriggerRef {
  automationVersionId: string;
  automationId: string;
  sourceNodeId: string;
  reentry: string;
}

export interface EnrollmentResult {
  enrollmentId: string;
  jobId: string;
}

export async function enrollAutomationsForEvent(
  database: OpenEngageDatabase,
  event: ContactEvent,
): Promise<EnrollmentResult[]> {
  const repository = new AutomationRepository(database, { workspaceId: event.workspaceId });
  const triggers = await repository.listActiveTriggersForEvent(
    event.type,
    event.resourceId ?? null,
  );

  const enrollments: EnrollmentResult[] = [];
  for (const trigger of triggers) {
    const result = await enrollFromTrigger(repository, trigger, {
      contactId: event.contactId,
      sourceEventId: event.id,
    });
    if (result) enrollments.push(result);
  }
  return enrollments;
}

export async function enrollInactiveContacts(
  database: OpenEngageDatabase,
  now = new Date(),
  limit = 200,
): Promise<number> {
  const engine = new AutomationEngineRepository(database);
  const candidates = await engine.listInactiveEnrollmentCandidates(now.toISOString(), limit);

  let enrolled = 0;
  for (const candidate of candidates) {
    const repository = new AutomationRepository(database, { workspaceId: candidate.workspaceId });
    const result = await enrollFromTrigger(repository, candidate, {
      contactId: candidate.contactId,
      sourceEventId: `inactive:${candidate.automationVersionId}:${candidate.contactId}`,
    });
    if (result) enrolled += 1;
  }
  return enrolled;
}

export type ManualEnrollOutcome =
  | { kind: "not_active" }
  | { kind: "source_missing" }
  | { kind: "already_enrolled" }
  | { kind: "enrolled"; result: EnrollmentResult };

/** API/SDK-driven enrollment of one contact into the published version. */
export async function enrollContactManually(
  database: OpenEngageDatabase,
  input: {
    workspaceId: string;
    automationId: string;
    contactId: string;
    sourceEventId: string;
  },
): Promise<ManualEnrollOutcome> {
  const repository = new AutomationRepository(database, { workspaceId: input.workspaceId });
  const automation = await repository.findActivePublishedAutomation(input.automationId);
  if (!automation) return { kind: "not_active" };
  const source = automation.graph.nodes.find((node) => node.type === "source");
  if (!source) return { kind: "source_missing" };
  const result = await enrollPublishedAutomation(database, {
    workspaceId: input.workspaceId,
    automationId: input.automationId,
    automationVersionId: automation.publishedVersionId,
    contactId: input.contactId,
    sourceNodeId: source.id,
    sourceEventId: input.sourceEventId,
  });
  if (!result) return { kind: "already_enrolled" };
  return { kind: "enrolled", result };
}

export async function enrollPublishedAutomation(
  database: OpenEngageDatabase,
  input: {
    workspaceId: string;
    automationId: string;
    automationVersionId: string;
    contactId: string;
    sourceNodeId: string;
    sourceEventId: string;
    reentry?: "once" | "every_time";
  },
): Promise<EnrollmentResult | null> {
  return enrollFromTrigger(
    new AutomationRepository(database, { workspaceId: input.workspaceId }),
    {
      automationId: input.automationId,
      automationVersionId: input.automationVersionId,
      sourceNodeId: input.sourceNodeId,
      reentry: input.reentry ?? "every_time",
    },
    {
      contactId: input.contactId,
      sourceEventId: input.sourceEventId,
    },
  );
}

async function enrollFromTrigger(
  repository: AutomationRepository,
  trigger: AutomationTriggerRef,
  input: {
    contactId: string;
    sourceEventId: string;
  },
): Promise<EnrollmentResult | null> {
  // "once" re-entry is enforced by storing the sentinel string "once" as the
  // source event id, which trips the enrollment unique index on any repeat.
  const sourceEventId = trigger.reentry === "once" ? "once" : input.sourceEventId;
  return repository.enrollContact({
    automationId: trigger.automationId,
    automationVersionId: trigger.automationVersionId,
    sourceNodeId: trigger.sourceNodeId,
    contactId: input.contactId,
    sourceEventId,
  });
}
