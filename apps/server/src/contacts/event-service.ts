import {
  AutomationEngineRepository,
  ContactEventRepository,
  type ContactEventProjection,
  type ContactEventRecord,
  type OpenEngageDatabase,
  uuidv7,
} from "@openengage/database";

import { enrollAutomationsForEvent } from "../automations/enrollment";
import { applyScoringForEvent, recomputeContactGrade } from "../scoring/engine";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import { recordCampaignTouches } from "./campaign-touch-service";

export interface ContactEventInput {
  id?: string;
  workspaceId: string;
  contactId: string | null;
  visitorId?: string | null;
  type: string;
  resourceType?: string | null;
  resourceId?: string | null;
  properties?: Record<string, unknown>;
  occurredAt?: string;
  queue?: Queue;
}

export async function recordContactEvent(
  database: OpenEngageDatabase,
  input: ContactEventInput,
): Promise<{ eventId: string; enrollmentCount: number }> {
  const eventId = input.id ?? uuidv7();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  await new ContactEventRepository(database).create({
    id: eventId,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    visitorId: input.visitorId ?? null,
    type: input.type,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    properties: input.properties ?? {},
    occurredAt,
    createdAt: new Date().toISOString(),
  });
  return processContactEvent(database, eventId, input.queue);
}

/** Backward-compatible name used by public forms; processing is now producer-agnostic. */
export async function processPendingPublicFormEvent(
  database: OpenEngageDatabase,
  eventId: string,
  queue?: Queue,
): Promise<void> {
  await processContactEvent(database, eventId, queue);
}

export async function retryPendingPublicFormEvents(
  database: OpenEngageDatabase,
  queue: Queue,
  limit = 50,
): Promise<Array<{ eventId: string; error: unknown }>> {
  const repository = new ContactEventRepository(database);
  const eventIds = await repository.listDueIds(new Date().toISOString(), limit);
  const failures: Array<{ eventId: string; error: unknown }> = [];
  for (const eventId of eventIds) {
    try {
      await processContactEvent(database, eventId, queue);
    } catch (error) {
      failures.push({ eventId, error });
    }
  }
  return failures;
}

async function processContactEvent(
  database: OpenEngageDatabase,
  eventId: string,
  queue?: Queue,
): Promise<{ eventId: string; enrollmentCount: number }> {
  const repository = new ContactEventRepository(database);
  const startedAt = new Date();
  const leaseId = uuidv7();
  const event = await repository.claim(
    eventId,
    startedAt.toISOString(),
    leaseId,
    new Date(startedAt.getTime() + 30_000).toISOString(),
  );
  if (!event) return { eventId, enrollmentCount: 0 };
  try {
    if (
      !event.contactId ||
      !(await repository.isContactProcessable(event.workspaceId, event.contactId))
    ) {
      await repository.skipPending(event.id, leaseId, new Date().toISOString());
      await repository.markProcessed(event.id, leaseId, new Date().toISOString());
      return { eventId, enrollmentCount: 0 };
    }

    let enrollmentCount = 0;
    for (const projection of await repository.pendingProjections(event.id)) {
      const result = await runProjection(
        database,
        event as ContactEventRecord & { contactId: string },
        projection,
        queue,
      );
      enrollmentCount += result.enrollmentCount;
      await repository.finishProjection(
        event.id,
        leaseId,
        projection,
        result.outcome,
        new Date().toISOString(),
      );
    }
    await repository.markProcessed(event.id, leaseId, new Date().toISOString());
    return { eventId, enrollmentCount };
  } catch (error) {
    await repository.markFailed(
      event.id,
      leaseId,
      error,
      new Date(Date.now() + 60_000).toISOString(),
    );
    throw error;
  }
}

async function runProjection(
  database: OpenEngageDatabase,
  event: ContactEventRecord & { contactId: string },
  projection: ContactEventProjection,
  queue?: Queue,
): Promise<{ outcome: "completed" | "skipped"; enrollmentCount: number }> {
  switch (projection) {
    case "scoring":
      await applyScoringForEvent(database, {
        id: event.id,
        workspaceId: event.workspaceId,
        contactId: event.contactId,
        type: event.type,
        resourceId: event.resourceId,
        properties: event.properties,
      });
      break;
    case "grade":
      await recomputeContactGrade(database, event.workspaceId, event.contactId);
      break;
    case "campaign":
      await recordCampaignTouches(database, {
        id: event.id,
        workspaceId: event.workspaceId,
        contactId: event.contactId,
        type: event.type,
        resourceId: event.resourceId,
        occurredAt: event.occurredAt,
      });
      break;
    case "decision_wake":
      await new AutomationEngineRepository(database).wakeWaitingDecisionJobs({
        workspaceId: event.workspaceId,
        contactId: event.contactId,
        eventType: event.type,
        resourceId: event.resourceId,
        occurredAt: event.occurredAt,
        now: new Date().toISOString(),
      });
      break;
    case "automation_enrollment": {
      const enrollments = await enrollAutomationsForEvent(database, {
        id: event.id,
        workspaceId: event.workspaceId,
        contactId: event.contactId,
        type: event.type,
        resourceId: event.resourceId,
      });
      return { outcome: "completed", enrollmentCount: enrollments.length };
    }
    case "segment_reconcile":
      if (!queue) return { outcome: "skipped", enrollmentCount: 0 };
      await enqueueSegmentContactReconciliation(queue, event.workspaceId, [event.contactId]);
      break;
  }
  return { outcome: "completed", enrollmentCount: 0 };
}
