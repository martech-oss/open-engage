import {
  AutomationJobRepository,
  AutomationJobRecoveryRepository,
} from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";
import {
  ContactImportRecoveryRepository,
  ContactImportReconciliationRepository,
} from "@openengage/database/contacts";
import { DeliveryRecoveryRepository } from "@openengage/database/messaging";

import { recoverAutomationCalls } from "../automations/call-service";
import { enrollInactiveContacts } from "../automations/enrollment";
import { dispatchScheduledAutomationRuns } from "../automations/run-service";
import { publishContactImportReconciliation } from "../contacts/worker";
import type { RuntimeEnv } from "../env";
import { logError } from "../observability";
import { runDailyMaintenance } from "../platform/maintenance-worker";
import { publishQueueBatches } from "../platform/queue-publisher";
import { recoverProjectClones } from "../projects/clone-service";
import { recoverProgramMemberImports } from "../projects/program-import-service";
import { runScoringDecay } from "../scoring/decay-service";
import { listDynamicSegmentsForCorrection } from "../segments/membership-service";
import { recoverLandingGenerations } from "../web/landing-design-service";
import { retryPendingPublicFormEvents } from "./contact-event-service";
import { dispatchDueAutomationJobs, runScheduledTasks, type ScheduledTask } from "./scheduler";
import { recoverVisitorHistories } from "./visitor-history-worker";

export async function scheduled(
  controller: ScheduledController,
  env: RuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  const reportFailure = (task: string, error: unknown) =>
    logError("scheduled.task_failed", error, { task });
  if (controller.cron === "17 3 * * *") {
    context.waitUntil(
      runScheduledTasks(
        [
          { name: "maintenance", run: () => runDailyMaintenance(env) },
          { name: "segments", run: () => enqueueSegmentCorrections(env) },
        ],
        reportFailure,
      ),
    );
    return;
  }
  await runScheduledTasks(createScheduledTasks(env), reportFailure);
}

function createScheduledTasks(env: RuntimeEnv): ScheduledTask[] {
  const database = createDatabase(env.DB);
  const jobs = new AutomationJobRepository(database);
  const recovery = new AutomationJobRecoveryRepository(database);
  return [
    {
      name: "contact_events",
      run: async () => {
        const failures = await retryPendingPublicFormEvents(database, env.JOBS_QUEUE);
        for (const failure of failures)
          logError("public_form.event_retry_failed", failure.error, { eventId: failure.eventId });
      },
    },
    { name: "scoring_decay", run: () => runScoringDecay(database, env.JOBS_QUEUE) },
    { name: "visitor_history", run: () => recoverVisitorHistories(env) },
    { name: "landing_generation", run: () => recoverLandingGenerations(env) },
    { name: "project_clones", run: () => recoverProjectClones(env) },
    { name: "segments", run: () => enqueueSegmentCorrections(env) },
    { name: "automation_enrollment", run: () => enrollInactiveContacts(database) },
    {
      name: "automation_runs",
      run: () => dispatchScheduledAutomationRuns(database, new Date(), 100, env.JOBS_QUEUE),
    },
    { name: "automation_calls", run: () => recoverAutomationCalls(database) },
    {
      name: "automation_jobs",
      run: () =>
        dispatchDueAutomationJobs(
          {
            recoverExpiredJobs: (now) => recovery.recoverExpiredJobs(now),
            workspacesWithDueJobs: (now, limit) => jobs.workspacesWithDueJobs(now, limit),
            claimDueJobs: (now, leaseUntil, limit, workspaceId) =>
              jobs.claimDueJobs(now, leaseUntil, limit, workspaceId),
            returnClaimsToPending: (claims, now) => recovery.returnClaimsToPending(claims, now),
            queue: env.JOBS_QUEUE,
          },
          new Date(),
        ),
    },
    { name: "contact_imports", run: () => recoverContactImports(env) },
    { name: "program_member_imports", run: () => recoverProgramMemberImports(env) },
    { name: "deliveries", run: () => recoverDeliveries(env) },
  ];
}

async function recoverContactImports(env: RuntimeEnv): Promise<void> {
  const database = createDatabase(env.DB);
  const recovery = new ContactImportRecoveryRepository(database);
  const reconciliation = new ContactImportReconciliationRepository(database);
  await recovery.recoverExpiredParts(new Date().toISOString());
  for (const item of await reconciliation.scanPending()) {
    await publishContactImportReconciliation(reconciliation, item, env.JOBS_QUEUE);
  }
  await publishQueueBatches(
    env.JOBS_QUEUE,
    (await recovery.scanPendingParts()).map((part) => ({
      body: { kind: "contact_import" as const, ...part },
    })),
  );
}

async function recoverDeliveries(env: RuntimeEnv): Promise<void> {
  const repository = new DeliveryRecoveryRepository(createDatabase(env.DB));
  const now = new Date().toISOString();
  await repository.recoverExpiredDeliveries(now);
  await publishQueueBatches(
    env.DELIVERY_QUEUE,
    (await repository.scanDueDeliveries(now)).map((delivery) => ({
      body: { kind: "delivery" as const, deliveryId: delivery.id },
    })),
  );
}

async function enqueueSegmentCorrections(env: RuntimeEnv): Promise<void> {
  const definitions = await listDynamicSegmentsForCorrection(createDatabase(env.DB));
  await publishQueueBatches(
    env.JOBS_QUEUE,
    definitions.map((definition) => ({
      body: { kind: "segment_full_refresh" as const, ...definition },
    })),
  );
}
