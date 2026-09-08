import { AutomationEngineRepository } from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { type ContactEventProjection } from "@openengage/database/contacts";

import { enrollAutomationsForEvent } from "../automations/enrollment";
import { recordCampaignTouches } from "../contacts/campaign-touch-service";
import {
  ContactEventProcessor,
  type ContactEventInput,
  type ContactEventProjectionResult,
  type ContactEventProjectionRunner,
  type ProcessableContactEvent,
} from "../contacts/event-service";
import { applyScoringForEvent, recomputeContactGrade } from "../scoring/engine";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import {
  recordLandingExperimentExposure,
  recordLandingExperimentConversion,
} from "../web/optimization-service";

type ProjectionHandler = (
  database: OpenEngageDatabase,
  event: ProcessableContactEvent,
  queue?: Queue,
) => Promise<ContactEventProjectionResult>;

const completedProjection: ContactEventProjectionResult = {
  outcome: "completed",
  enrollmentCount: 0,
};

const projectionHandlers = {
  scoring: async (database, event) => {
    await applyScoringForEvent(database, {
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: event.type,
      resourceId: event.resourceId,
      properties: event.properties,
    });
    return completedProjection;
  },
  grade: async (database, event) => {
    await recomputeContactGrade(database, event.workspaceId, event.contactId);
    return completedProjection;
  },
  campaign: async (database, event) => {
    await recordCampaignTouches(database, {
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: event.type,
      resourceId: event.resourceId,
      occurredAt: event.occurredAt,
      properties: event.properties,
    });
    return completedProjection;
  },
  decision_wake: async (database, event) => {
    await new AutomationEngineRepository(database).wakeWaitingDecisionJobs({
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      eventType: event.type,
      resourceId: event.resourceId,
      occurredAt: event.occurredAt,
      now: new Date().toISOString(),
    });
    return completedProjection;
  },
  automation_enrollment: async (database, event) => {
    const enrollments = await enrollAutomationsForEvent(database, {
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: event.type,
      resourceId: event.resourceId,
    });
    return { outcome: "completed", enrollmentCount: enrollments.length };
  },
  segment_reconcile: async (_database, event, queue) => {
    if (!queue) return { outcome: "skipped", enrollmentCount: 0 };
    await enqueueSegmentContactReconciliation(queue, event.workspaceId, [event.contactId]);
    return completedProjection;
  },
} satisfies Record<ContactEventProjection, ProjectionHandler>;

const runProjection: ContactEventProjectionRunner = async ({
  database,
  event,
  projection,
  queue,
}) => projectionHandlers[projection](database, event, queue);

function createContactEventProcessor(database: OpenEngageDatabase): ContactEventProcessor {
  return new ContactEventProcessor(database, runProjection, async (event) => {
    const { exposureId, pageVersionId } = event.properties;
    if (!event.visitorId || typeof exposureId !== "string" || typeof pageVersionId !== "string")
      return;
    const identity = {
      workspaceId: event.workspaceId,
      visitorId: event.visitorId,
      exposureId,
      pageVersionId,
    };
    if (event.type === "page_viewed")
      await recordLandingExperimentExposure(database, identity, event.occurredAt);
    if (event.type === "form_submitted")
      await recordLandingExperimentConversion(database, identity, event.occurredAt);
  });
}

export function recordContactEvent(
  database: OpenEngageDatabase,
  input: ContactEventInput,
): Promise<{ eventId: string; enrollmentCount: number }> {
  return createContactEventProcessor(database).record(input);
}

/** Backward-compatible name retained for existing event producers. */
export async function processPendingPublicFormEvent(
  database: OpenEngageDatabase,
  eventId: string,
  queue?: Queue,
): Promise<void> {
  await createContactEventProcessor(database).process(eventId, queue);
}

export function retryPendingPublicFormEvents(
  database: OpenEngageDatabase,
  queue: Queue,
  limit = 50,
): Promise<Array<{ eventId: string; error: unknown }>> {
  return createContactEventProcessor(database).retryDue(queue, limit);
}
