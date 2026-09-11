import {
  outgoingEdges,
  type AutomationDefinition,
  type AutomationEdge,
} from "@openengage/core/automations";
import { AUTOMATION_MAX_STARTS, type AutomationJobRow } from "@openengage/database/automations";

import { PermanentChannelError } from "../channels";
import type { AutomationWorkerDependencies } from "./execution-dependencies";
import { executeNode } from "./node-execution";

export async function processAutomationJob(
  jobId: string,
  leaseId: string,
  dependencies: AutomationWorkerDependencies,
): Promise<void> {
  const { jobs, recovery, clock } = dependencies;
  const job = await jobs.findJobForProcessing(jobId, leaseId);
  if (!job) return;
  const started = await jobs.startLeasedJob(jobId, leaseId, clock().toISOString());
  if (!started && job.status !== "running") {
    if (job.attempts >= AUTOMATION_MAX_STARTS) {
      await recovery.failJobAndEnrollmentForLease(
        job.id,
        leaseId,
        "Automation attempts exhausted",
        clock().toISOString(),
      );
    }
    return;
  }

  try {
    const definition = job.graph;
    const node = definition.nodes.find((candidate) => candidate.id === job.nodeId);
    if (!node) throw new PermanentChannelError(`Automation node ${job.nodeId} is missing`);
    const result = await executeNode(node, definition, job, leaseId, dependencies.nodes);
    if (result.parked) return;
    if (result.waitUntil) {
      await jobs.parkJobUntil(job.id, leaseId, {
        dueAt: result.waitUntil,
        payload: JSON.stringify({ waiting: true }),
        now: clock().toISOString(),
        waitEventType: result.waitEventType ?? null,
        waitResourceId: result.waitResourceId ?? null,
        waitStartedAt: result.waitStartedAt ?? null,
      });
      return;
    }
    await finishNode(job, leaseId, definition, result.branch, jobs, clock);
  } catch (error) {
    const failure = await recovery.recordJobFailure(
      job.id,
      leaseId,
      error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      clock().toISOString(),
      error instanceof PermanentChannelError,
    );
    if (failure === "retry" || error instanceof PermanentChannelError) throw error;
  }
}

async function finishNode(
  job: AutomationJobRow,
  leaseId: string,
  definition: AutomationDefinition,
  branch: AutomationEdge["branch"] | undefined,
  jobs: AutomationWorkerDependencies["jobs"],
  clock: () => Date,
): Promise<void> {
  const next = outgoingEdges(definition, job.nodeId, branch ?? "next")[0];
  const now = clock().toISOString();
  if (!next) {
    await jobs.completeJobClosingEnrollment(job, leaseId, now);
    return;
  }
  await jobs.completeJobAdvancingEnrollment(job, leaseId, next.target, now);
}
