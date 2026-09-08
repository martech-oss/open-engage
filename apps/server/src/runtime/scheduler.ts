import { publishQueueBatches, type QueuePublisher } from "../platform/queue-publisher";
import type { AutomationJobQueueMessage } from "./queues";

export interface ScheduledTask {
  name: string;
  run(): Promise<unknown>;
}

/** Preserve domain ordering while allowing independent domains to recover after failures. */
export async function runScheduledTasks(
  tasks: readonly ScheduledTask[],
  reportFailure: (name: string, error: unknown) => void,
): Promise<void> {
  const failures: unknown[] = [];
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      failures.push(error);
      reportFailure(task.name, error);
    }
  }
  // Preserve the original error for a single failure and callers that classify it.
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Scheduled tasks failed");
}

type Claim = { id: string; leaseId: string };
export interface AutomationDispatchPorts {
  recoverExpiredJobs(now: string): Promise<void>;
  workspacesWithDueJobs(now: string, limit: number): Promise<Array<{ workspaceId: string }>>;
  claimDueJobs(
    now: string,
    leaseUntil: string,
    limit: number,
    workspaceId: string,
  ): Promise<Claim[]>;
  returnClaimsToPending(claims: readonly Claim[], now: string): Promise<void>;
  queue: QueuePublisher<AutomationJobQueueMessage>;
}

export async function dispatchDueAutomationJobs(
  ports: AutomationDispatchPorts,
  clock: Date,
): Promise<void> {
  const now = clock.toISOString();
  const leaseUntil = new Date(clock.getTime() + 5 * 60_000).toISOString();
  await ports.recoverExpiredJobs(now);
  const workspaces = await ports.workspacesWithDueJobs(now, 50);
  const claims: Claim[] = [];
  let published = 0;
  try {
    for (const workspace of workspaces) {
      claims.push(...(await ports.claimDueJobs(now, leaseUntil, 20, workspace.workspaceId)));
    }
    await publishQueueBatches(
      ports.queue,
      claims.map((claim) => ({
        body: { kind: "automation_job" as const, jobId: claim.id, leaseId: claim.leaseId },
      })),
      (count) => {
        published += count;
      },
    );
  } catch (error) {
    await ports.returnClaimsToPending(claims.slice(published), now);
    throw error;
  }
}
