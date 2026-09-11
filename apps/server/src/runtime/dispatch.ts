import { retryDelaySeconds } from "@openengage/core/platform";
import { createDatabase } from "@openengage/database/client";

import { dispatchScheduledAutomationRuns, processAutomationRun } from "../automations/run-service";
import { processAutomationJob } from "../automations/worker";
import { PermanentChannelError } from "../channels";
import { processContactExport, processContactImport } from "../contacts/worker";
import { type RuntimeEnv } from "../env";
import { processCloudflareEmailEvent } from "../messaging/cloudflare-events";
import { processDelivery } from "../messaging/delivery-worker";
import { logError } from "../observability";
import { persistDeadLetter } from "../platform/maintenance-worker";
import { processProjectClone } from "../projects/clone-service";
import { processProgramMemberImport } from "../projects/program-import-service";
import { runScoringDecay } from "../scoring/decay-service";
import {
  reconcileContactSegmentMemberships,
  refreshSegmentMemberships,
} from "../segments/membership-service";
import { processLandingGeneration } from "../web/landing-generation-service";
import { processPendingPublicFormEvent } from "./contact-event-service";
import {
  deliveryQueueMessageSchema,
  jobsQueueMessageSchema,
  programMemberImportQueueMessageSchema,
  type JobsQueueMessage,
} from "./queues";
import { processVisitorHistory } from "./visitor-history-worker";

type JobsQueueHandlerMap = {
  [Kind in JobsQueueMessage["kind"]]: (
    message: Extract<JobsQueueMessage, { kind: Kind }>,
    env: RuntimeEnv,
  ) => Promise<void>;
};

export const jobsQueueHandlers = {
  scoring_decay: async (message, env) => {
    await runScoringDecay(createDatabase(env.DB), env.JOBS_QUEUE, new Date(message.now));
  },
  automation_schedule: async (message, env) => {
    await dispatchScheduledAutomationRuns(
      createDatabase(env.DB),
      new Date(message.now),
      100,
      env.JOBS_QUEUE,
      message.afterAutomationId,
    );
  },
  automation_run: async (message, env) => {
    await processAutomationRun(
      message.runId,
      message.workspaceId,
      createDatabase(env.DB),
      100,
      env.JOBS_QUEUE,
    );
  },
  project_clone: async (message, env) => {
    await processProjectClone(env, message.workspaceId, message.jobId);
  },
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

export { scheduled } from "./scheduled-tasks";

export async function queue(batch: MessageBatch<unknown>, env: RuntimeEnv): Promise<void> {
  const programImport = isQueue(batch.queue, "program-member-import");
  await runBounded(batch.messages, programImport ? 1 : 5, async (message) => {
    if (isQueue(batch.queue, "dead-letter")) {
      await persistDeadLetter(batch.queue, message.body, message.attempts, env);
      message.ack();
      return;
    }
    try {
      if (programImport) {
        const parsed = programMemberImportQueueMessageSchema.safeParse(message.body);
        if (!parsed.success)
          throw new PermanentChannelError("Invalid program import queue message");
        await processProgramMemberImport(env, parsed.data.workspaceId, parsed.data.jobId);
      } else if (isQueue(batch.queue, "jobs")) {
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

function isQueue(actual: string, suffix: string): boolean {
  return actual === `openengage-${suffix}` || actual.endsWith(`-${suffix}`);
}
