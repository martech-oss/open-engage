import { createDatabase } from "@openengage/database/client";
import { VisitorRepository } from "@openengage/database/contacts";

import type { RuntimeEnv } from "../env";
import { logError } from "../observability";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import { processPendingPublicFormEvent } from "./contact-event-service";

/** Each binding and event has recoverable work; no queue delivery is the source of truth. */
export async function processVisitorHistory(
  env: RuntimeEnv,
  workspaceId: string,
  visitorId: string,
): Promise<void> {
  const database = createDatabase(env.DB);
  const repository = new VisitorRepository(database);
  const leaseId = crypto.randomUUID();
  const binding = await repository.claimHistory(workspaceId, visitorId, leaseId);
  if (!binding) return;
  let done = false;
  try {
    if (!(await repository.findContact(workspaceId, binding.contactId))) {
      done = true;
      return;
    }
    const ids = await repository.restoreHistory(workspaceId, visitorId, binding.contactId);
    for (const id of ids) await processPendingPublicFormEvent(database, id, env.JOBS_QUEUE);
    if (!(await repository.hasHistoryWork(workspaceId, visitorId))) {
      // Queue before closing work so a failed enqueue remains recoverable.
      await enqueueSegmentContactReconciliation(env.JOBS_QUEUE, workspaceId, [binding.contactId]);
      done = true;
    }
  } finally {
    await repository.releaseHistory(workspaceId, visitorId, leaseId, done);
  }
}

export async function recoverVisitorHistories(env: RuntimeEnv): Promise<void> {
  const pending = await new VisitorRepository(createDatabase(env.DB)).pendingHistory();
  for (const binding of pending) {
    try {
      await processVisitorHistory(env, binding.workspaceId, binding.visitorId);
    } catch (error) {
      logError("visitor.history_failed", error, {
        workspaceId: binding.workspaceId,
        visitorId: binding.visitorId,
      });
    }
  }
}
