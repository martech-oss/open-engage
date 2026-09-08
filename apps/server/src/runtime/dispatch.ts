import { retryDelaySeconds } from "@openengage/core/platform";
import {
  AutomationEngineRepository,
  AutomationJobRecoveryRepository,
  claimDueJobs,
} from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";
import {
  ContactImportRecoveryRepository,
  ContactImportReconciliationRepository,
} from "@openengage/database/contacts";
import { DeliveryRecoveryRepository } from "@openengage/database/messaging";

import { enrollInactiveContacts } from "../automations/enrollment";
import { processAutomationJob } from "../automations/worker";
import { PermanentChannelError } from "../channels";
import {
  processContactExport,
  processContactImport,
  publishContactImportReconciliation,
} from "../contacts/worker";
import { type RuntimeEnv } from "../env";
import { processCloudflareEmailEvent } from "../messaging/cloudflare-events";
import { processDelivery } from "../messaging/delivery-worker";
import { logError } from "../observability";
import { persistDeadLetter, runDailyMaintenance } from "../platform/maintenance-worker";
import {
  listDynamicSegmentsForCorrection,
  reconcileContactSegmentMemberships,
  refreshSegmentMemberships,
} from "../segments/membership-service";
import { processLandingGeneration, recoverLandingGenerations } from "../web/landing-design-service";
import {
  processPendingPublicFormEvent,
  retryPendingPublicFormEvents,
} from "./contact-event-service";
import {
  deliveryQueueMessageSchema,
  jobsQueueMessageSchema,
  type JobsQueueMessage,
  type QueueMessage as OpenEngageQueueMessage,
} from "./queues";
import { processVisitorHistory, recoverVisitorHistories } from "./visitor-history-worker";

type JobsQueueHandlerMap = {
  [Kind in JobsQueueMessage["kind"]]: (
    message: Extract<JobsQueueMessage, { kind: Kind }>,
    env: RuntimeEnv,
  ) => Promise<void>;
};

export const jobsQueueHandlers = {
  landing_generation: async (message, env) => {
    await processLandingGeneration(message.jobId, env);
  },
  visitor_history: async (message, env) => {
    await processVisitorHistory(env, message.workspaceId, message.visitorId);
  },
  automation_job: async (message, env) => {
    await processAutomationJob(message.jobId, message.leaseId, env);
  },
  contact_event: async (message, env) => {
    await processPendingPublicFormEvent(createDatabase(env.DB), message.eventId, env.JOBS_QUEUE);
  },
  contact_import: async (message, env) => {
    await processContactImport(message.importJobId, message.part, message.totalParts, env);
  },
  contact_export: async (message, env) => {
    await processContactExport(message.exportJobId, env);
  },
  segment_contact_reconcile: async (message, env) => {
    await reconcileContactSegmentMemberships(
      createDatabase(env.DB),
      message.workspaceId,
      message.contactId,
    );
  },
  segment_full_refresh: async (message, env) => {
    await refreshSegmentMemberships(
      createDatabase(env.DB),
      message.workspaceId,
      message.segmentId,
      message.filterVersion,
    );
  },
} satisfies JobsQueueHandlerMap;

export async function scheduled(
  controller: ScheduledController,
  env: RuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  if (controller.cron === "17 3 * * *") {
    context.waitUntil(Promise.all([runDailyMaintenance(env), enqueueSegmentCorrections(env)]));
    return;
  }
  const database = createDatabase(env.DB);
  const publicFormEventFailures = await retryPendingPublicFormEvents(database, env.JOBS_QUEUE);
  for (const failure of publicFormEventFailures) {
    logError("public_form.event_retry_failed", failure.error, { eventId: failure.eventId });
  }
  await recoverVisitorHistories(env);
  await recoverLandingGenerations(env);
  await enqueueSegmentCorrections(env);
  await enrollInactiveContacts(database);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const engine = new AutomationEngineRepository(database);
  const recovery = new AutomationJobRecoveryRepository(database);
  await recovery.recoverExpiredJobs(now);
  const workspaces = await engine.workspacesWithDueJobs(now, 50);
  const messages: Array<{ body: OpenEngageQueueMessage }> = [];
  const automationClaims: Array<{ id: string; leaseId: string }> = [];
  for (const workspace of workspaces) {
    const jobs = await claimDueJobs(database, now, leaseUntil, 20, workspace.workspaceId);
    for (const job of jobs) {
      automationClaims.push(job);
      messages.push({
        body: { kind: "automation_job", jobId: job.id, leaseId: job.leaseId },
      });
    }
  }
  if (messages.length > 0) {
    try {
      await env.JOBS_QUEUE.sendBatch(messages);
    } catch (error) {
      await recovery.returnClaimsToPending(automationClaims, new Date().toISOString());
      throw error;
    }
  }

  const importRecovery = new ContactImportRecoveryRepository(database);
  const importReconciliation = new ContactImportReconciliationRepository(database);
  await importRecovery.recoverExpiredParts(now);
  const importReconciliations = await importReconciliation.scanPending();
  for (const reconciliation of importReconciliations) {
    await publishContactImportReconciliation(importReconciliation, reconciliation, env.JOBS_QUEUE);
  }
  const importParts = await importRecovery.scanPendingParts();
  if (importParts.length > 0) {
    await env.JOBS_QUEUE.sendBatch(
      importParts.map((part) => ({ body: { kind: "contact_import" as const, ...part } })),
    );
  }

  const deliveryRecovery = new DeliveryRecoveryRepository(database);
  await deliveryRecovery.recoverExpiredDeliveries(now);
  const dueDeliveries = await deliveryRecovery.scanDueDeliveries(now);
  if (dueDeliveries.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(
      dueDeliveries.map((delivery) => ({
        body: { kind: "delivery", deliveryId: delivery.id },
      })),
    );
  }
}

export async function queue(batch: MessageBatch<unknown>, env: RuntimeEnv): Promise<void> {
  await runBounded(batch.messages, 5, async (message) => {
    if (isQueue(batch.queue, "dead-letter")) {
      await persistDeadLetter(batch.queue, message.body, message.attempts, env);
      message.ack();
      return;
    }
    try {
      if (isQueue(batch.queue, "jobs")) {
        const parsed = jobsQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) throw new PermanentChannelError("Invalid jobs queue message");
        await dispatchJobsQueueMessage(parsed.data, env);
      } else if (isQueue(batch.queue, "delivery")) {
        const parsed = deliveryQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) throw new PermanentChannelError("Invalid delivery queue message");
        await processDelivery(parsed.data.deliveryId, env);
      } else if (isQueue(batch.queue, "email-events")) {
        await processCloudflareEmailEvent(message.body, env);
      } else {
        throw new PermanentChannelError(`Unknown queue: ${batch.queue}`);
      }
      message.ack();
    } catch (error) {
      logError("queue.message_failed", error, {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
      });
      if (error instanceof PermanentChannelError) {
        await persistDeadLetter(batch.queue, message.body, message.attempts, env, error.message);
        message.ack();
      } else {
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }
  });
}

async function dispatchJobsQueueMessage(message: JobsQueueMessage, env: RuntimeEnv): Promise<void> {
  await jobsQueueHandlers[message.kind](message as never, env);
}

async function runBounded<T>(
  items: readonly T[],
  maximumConcurrency: number,
  process: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await process(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrency, items.length) }, async () => worker()),
  );
}

async function enqueueSegmentCorrections(env: RuntimeEnv): Promise<void> {
  const definitions = await listDynamicSegmentsForCorrection(createDatabase(env.DB));
  if (definitions.length === 0) return;
  for (let index = 0; index < definitions.length; index += 100) {
    await env.JOBS_QUEUE.sendBatch(
      definitions.slice(index, index + 100).map((definition) => ({
        body: { kind: "segment_full_refresh" as const, ...definition },
      })),
    );
  }
}

function isQueue(actual: string, suffix: string): boolean {
  return actual === `openengage-${suffix}` || actual.endsWith(`-${suffix}`);
}
