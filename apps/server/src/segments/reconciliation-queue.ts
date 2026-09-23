import type { JobsQueue } from "../platform/queue-messages";
import { publishQueueBatches } from "../platform/queue-publisher";

export async function enqueueSegmentContactReconciliation(
  queue: JobsQueue,
  workspaceId: string,
  contactIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(contactIds)].filter(Boolean);
  await publishQueueBatches(
    queue,
    uniqueIds.map((contactId) => ({
      body: { kind: "segment_contact_reconcile" as const, workspaceId, contactId },
    })),
  );
}

/** Requeues segment membership for the contacts a request's write touched. */
export function requeueContactSegments(
  context: { env: { JOBS_QUEUE: JobsQueue }; workspace: { workspaceId: string } },
  contactIds: readonly string[],
): Promise<void> {
  return enqueueSegmentContactReconciliation(
    context.env.JOBS_QUEUE,
    context.workspace.workspaceId,
    contactIds,
  );
}
