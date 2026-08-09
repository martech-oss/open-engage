import { retryDelaySeconds } from "@openengage/core/platform";
import {
  AutomationEngineRepository,
  claimDueJobs,
  createDatabase,
  MessagingWorkerRepository,
} from "@openengage/database";

import { enrollInactiveContacts } from "../automations/enrollment";
import { processAutomationJob } from "../automations/worker";
import { PermanentChannelError } from "../channels";
import { processContactExport, processContactImport } from "../contacts/worker";
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
import {
  deliveryQueueMessageSchema,
  jobsQueueMessageSchema,
  type QueueMessage as OpenEngageQueueMessage,
} from "./queues";

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
  await enrollInactiveContacts(database);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const engine = new AutomationEngineRepository(database);
  const workspaces = await engine.workspacesWithDueJobs(now, 50);
  const messages: Array<{ body: OpenEngageQueueMessage }> = [];
  for (const workspace of workspaces) {
    const jobs = await claimDueJobs(database, now, leaseUntil, 20, workspace.workspaceId);
    for (const job of jobs) {
      messages.push({
        body: { kind: "automation_job", jobId: job.id, leaseId: job.leaseId },
      });
    }
  }
  if (messages.length > 0) await env.JOBS_QUEUE.sendBatch(messages);

  const dueDeliveries = await new MessagingWorkerRepository(database).scanDueDeliveries(now);
  if (dueDeliveries.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(
      dueDeliveries.map((delivery) => ({
        body: { kind: "delivery", deliveryId: delivery.id },
      })),
    );
  }
}

export async function queue(batch: MessageBatch<unknown>, env: RuntimeEnv): Promise<void> {
  for (const message of batch.messages) {
    if (isQueue(batch.queue, "dead-letter")) {
      await persistDeadLetter(batch.queue, message.body, message.attempts, env);
      message.ack();
      continue;
    }
    try {
      if (isQueue(batch.queue, "jobs")) {
        const parsed = jobsQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) throw new PermanentChannelError("Invalid jobs queue message");
        switch (parsed.data.kind) {
          case "automation_job":
            await processAutomationJob(parsed.data.jobId, parsed.data.leaseId, env);
            break;
          case "contact_import":
            await processContactImport(
              parsed.data.importJobId,
              parsed.data.part,
              parsed.data.totalParts,
              env,
            );
            break;
          case "contact_export":
            await processContactExport(parsed.data.exportJobId, env);
            break;
          case "segment_contact_reconcile":
            await reconcileContactSegmentMemberships(
              createDatabase(env.DB),
              parsed.data.workspaceId,
              parsed.data.contactId,
            );
            break;
          case "segment_full_refresh":
            await refreshSegmentMemberships(
              createDatabase(env.DB),
              parsed.data.workspaceId,
              parsed.data.segmentId,
              parsed.data.filterVersion,
            );
            break;
        }
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
  }
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
