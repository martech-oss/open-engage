import { and, eq, exists, sql } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { assertAutomationJobTransition, type AutomationJobRow } from "./engine-support";
import { automationEnrollments, automationJobs } from "./schema";

/** Lease-qualified job success and its enrollment/next-job effects. */
export class AutomationCompletionRepository extends DatabaseRepository {
  public async closeEnrollment(
    job: Pick<AutomationJobRow, "id" | "workspaceId" | "enrollmentId">,
    leaseId: string,
    now: string,
  ): Promise<void> {
    assertAutomationJobTransition("running", "succeeded");
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(automationEnrollments)
        .set({ status: "completed", currentNodeId: null, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(automationEnrollments.workspaceId, job.workspaceId),
            eq(automationEnrollments.id, job.enrollmentId),
            eq(automationEnrollments.status, "active"),
            this.runningLeaseExists(job.id, leaseId),
          ),
        ),
      this.jobSucceededUpdate(job.id, leaseId, now),
    ]);
  }

  public async advanceEnrollment(
    job: Pick<
      AutomationJobRow,
      "id" | "workspaceId" | "enrollmentId" | "automationVersionId" | "contactId"
    >,
    leaseId: string,
    nextNodeId: string,
    now: string,
  ): Promise<void> {
    assertAutomationJobTransition("running", "succeeded");
    const orm = this.database.orm;
    const currentLease = this.runningLeaseCondition(job.id, leaseId);
    await orm.batch([
      orm
        .insert(automationJobs)
        .select(
          orm
            .select({
              id: sql<string>`${uuidv7()}`.as("id"),
              workspaceId: automationJobs.workspaceId,
              enrollmentId: automationJobs.enrollmentId,
              automationVersionId: automationJobs.automationVersionId,
              nodeId: sql<string>`${nextNodeId}`.as("node_id"),
              contactId: automationJobs.contactId,
              idempotencyKey:
                sql<string>`${`${job.enrollmentId}:${nextNodeId}:${job.contactId}`}`.as(
                  "idempotency_key",
                ),
              payload: sql<string>`'{}'`.as("payload"),
              status: sql<string>`'pending'`.as("status"),
              dueAt: sql<string>`${now}`.as("due_at"),
              leaseId: sql<string | null>`NULL`.as("lease_id"),
              leaseUntil: sql<string | null>`NULL`.as("lease_until"),
              waitEventType: sql<string | null>`NULL`.as("wait_event_type"),
              waitResourceId: sql<string | null>`NULL`.as("wait_resource_id"),
              attempts: sql<number>`0`.as("attempts"),
              lastError: sql<string | null>`NULL`.as("last_error"),
              createdAt: sql<string>`${now}`.as("created_at"),
              updatedAt: sql<string>`${now}`.as("updated_at"),
            })
            .from(automationJobs)
            .where(currentLease),
        )
        .onConflictDoNothing(),
      orm
        .update(automationEnrollments)
        .set({ currentNodeId: nextNodeId, updatedAt: now })
        .where(
          and(
            eq(automationEnrollments.workspaceId, job.workspaceId),
            eq(automationEnrollments.id, job.enrollmentId),
            eq(automationEnrollments.status, "active"),
            this.runningLeaseExists(job.id, leaseId),
          ),
        ),
      this.jobSucceededUpdate(job.id, leaseId, now),
    ]);
  }

  private runningLeaseExists(jobId: string, leaseId: string) {
    return exists(
      this.database.orm
        .select({ id: automationJobs.id })
        .from(automationJobs)
        .where(this.runningLeaseCondition(jobId, leaseId)),
    );
  }

  private runningLeaseCondition(jobId: string, leaseId: string) {
    return and(
      eq(automationJobs.id, jobId),
      eq(automationJobs.status, "running"),
      eq(automationJobs.leaseId, leaseId),
    );
  }

  private jobSucceededUpdate(jobId: string, leaseId: string, now: string) {
    return this.database.orm
      .update(automationJobs)
      .set({
        status: "succeeded",
        leaseId: null,
        leaseUntil: null,
        waitEventType: null,
        waitResourceId: null,
        updatedAt: now,
      })
      .where(this.runningLeaseCondition(jobId, leaseId));
  }
}
