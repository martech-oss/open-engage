import { automationDefinitionSchema, latestAutomationSlot } from "@openengage/core/automations";
import {
  AutomationEnrollmentRepository,
  AutomationRunRepository,
  AutomationRunRecoveryRepository,
} from "@openengage/database/automations";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { logError } from "../observability";

/** Bounded work; reruns continue the durable target ledger, never reselect the audience. */
export async function processAutomationRun(
  runId: string,
  workspaceId: string,
  database: OpenEngageDatabase,
  limit = 100,
  queue?: Queue,
): Promise<void> {
  const repo = new AutomationRunRepository(database, { workspaceId }),
    run = await repo.runVersion(runId);
  if (!run || !["enrolling", "running"].includes(run.status)) return;
  const source = run.graph.nodes.find((node) => node.type === "source");
  if (!source) throw new Error("開始条件がありません");
  const enrollment = new AutomationEnrollmentRepository(database, { workspaceId });
  for (const target of await repo.pendingTargets(runId, limit)) {
    try {
      const result = await enrollment.enrollContact({
        automationId: run.automationId,
        automationVersionId: run.automationVersionId,
        sourceNodeId: source.id,
        contactId: target.contactId,
        sourceEventId: `run:${runId}:${target.contactId}`,
        runId,
      });
      if (!result) await repo.skipTarget(runId, target.contactId, "archived_or_reentry");
    } catch (error) {
      logError("automation.batch_enrollment_failed", error, {
        runId,
        workspaceId,
        contactId: target.contactId,
      });
      await repo.failTarget(
        runId,
        target.contactId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  await repo.refresh(runId);
  if (queue && (await repo.pendingTargets(runId, 1)).length)
    await queue.send({ kind: "automation_run", workspaceId, runId });
}

/** Each Queue message scans one ordered page at the original Cron timestamp. */
export async function dispatchScheduledAutomationRuns(
  database: OpenEngageDatabase,
  now = new Date(),
  limit = 100,
  queue?: Queue,
  afterAutomationId?: string,
): Promise<void> {
  const recovery = new AutomationRunRecoveryRepository(database);
  let cursor = afterAutomationId;
  do {
    const rows = await recovery.scheduled(limit, cursor);
    for (const row of rows) {
      try {
        const graph = automationDefinitionSchema.parse(JSON.parse(row.graph));
        const source = graph.nodes.find((node) => node.type === "source");
        if (source?.config.source !== "batch") continue;
        const last = await recovery.latestSlot(row.workspaceId, row.automationId);
        const slot = latestAutomationSlot(
          source.config.schedule,
          new Date(last ?? row.publishedAt ?? now.toISOString()),
          now,
          graph.timezone,
        );
        if (!slot) continue;
        const run = await new AutomationRunRepository(database, {
          workspaceId: row.workspaceId,
        }).startRun(row.automationId, slot.toISOString(), now.toISOString(), row.versionId);
        if (now.getTime() - slot.getTime() > 5 * 60_000)
          logError(
            "automation.schedule_delayed",
            new Error("Scheduled slot is more than five minutes late"),
            {
              runId: run.id,
              workspaceId: row.workspaceId,
              slot: slot.toISOString(),
              delayMinutes: Math.floor((now.getTime() - slot.getTime()) / 60_000),
            },
          );
        if (queue)
          await queue.send({ kind: "automation_run", workspaceId: row.workspaceId, runId: run.id });
      } catch (error) {
        logError("automation.schedule_failed", error, {
          workspaceId: row.workspaceId,
          automationId: row.automationId,
        });
      }
    }
    cursor = rows.length === limit ? rows.at(-1)?.automationId : undefined;
    if (queue && cursor)
      await queue.send({
        kind: "automation_schedule",
        now: now.toISOString(),
        afterAutomationId: cursor,
      });
  } while (!queue && cursor);
  // Each Cron invocation also retries interrupted registration, independently of scan pages.
  if (afterAutomationId) return;
  for (const run of await recovery.recoverable(limit)) {
    if (queue)
      await queue.send({ kind: "automation_run", workspaceId: run.workspaceId, runId: run.id });
    else
      await new AutomationRunRepository(database, { workspaceId: run.workspaceId }).refresh(run.id);
  }
}
