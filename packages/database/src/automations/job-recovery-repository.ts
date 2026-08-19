import { and, asc, eq, exists, inArray, lte } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";
import { assertAutomationJobTransition, AUTOMATION_MAX_STARTS } from "./engine-support";
import { automationEnrollments, automationJobs } from "./schema";

/** Lease recovery and terminal failure transitions for automation jobs. */
export class AutomationJobRecoveryRepository extends DatabaseRepository {
  public async recoverExpiredJobs(now: string, limit = 500): Promise<void> {
    const rows = await this.database.orm
      .select({
        id: automationJobs.id,
        status: automationJobs.status,
        leaseId: automationJobs.leaseId,
        attempts: automationJobs.attempts,
      })
      .from(automationJobs)
      .where(
        and(
          inArray(automationJobs.status, ["leased", "running"]),
          lte(automationJobs.leaseUntil, now),
        ),
      )
      .orderBy(asc(automationJobs.leaseUntil))
      .limit(limit);

    for (const row of rows) {
      if (!row.leaseId) continue;
      if (row.attempts >= AUTOMATION_MAX_STARTS) {
        await this.failJobAndEnrollmentForLease(
          row.id,
          row.leaseId,
          "Automation attempts exhausted",
          now,
        );
        continue;
      }
      assertAutomationJobTransition(row.status as "leased" | "running", "pending");
      await this.database.orm
        .update(automationJobs)
        .set({
          status: "pending",
          leaseId: null,
          leaseUntil: null,
          lastError: "Automation lease expired",
          updatedAt: now,
        })
        .where(
          and(
            eq(automationJobs.id, row.id),
            eq(automationJobs.leaseId, row.leaseId),
            eq(automationJobs.status, row.status),
            lte(automationJobs.leaseUntil, now),
          ),
        );
    }
  }

  /** Clears only claims from the failed publish batch; newer leases survive. */
  public async returnClaimsToPending(
    claims: ReadonlyArray<{ id: string; leaseId: string }>,
    now: string,
  ): Promise<void> {
    if (claims.length === 0) return;
    assertAutomationJobTransition("leased", "pending");
    for (let offset = 0; offset < claims.length; offset += 100) {
      const statements = claims.slice(offset, offset + 100).map((claim) =>
        this.database.orm
          .update(automationJobs)
          .set({ status: "pending", leaseId: null, leaseUntil: null, updatedAt: now })
          .where(
            and(
              eq(automationJobs.id, claim.id),
              eq(automationJobs.leaseId, claim.leaseId),
              eq(automationJobs.status, "leased"),
            ),
          ),
      );
      const [first, ...rest] = statements;
      if (first) await this.database.orm.batch([first, ...rest]);
    }
  }

  public async recordJobFailure(
    jobId: string,
    leaseId: string,
    lastError: string,
    now: string,
    permanent: boolean,
  ): Promise<"retry" | "failed" | "stale"> {
    const row = await this.database.orm
      .select({ attempts: automationJobs.attempts })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "running"),
        ),
      )
      .get();
    if (!row) return "stale";
    if (permanent || row.attempts >= AUTOMATION_MAX_STARTS) {
      return (await this.failJobAndEnrollmentForLease(jobId, leaseId, lastError, now))
        ? "failed"
        : "stale";
    }
    assertAutomationJobTransition("running", "leased");
    await this.database.orm
      .update(automationJobs)
      .set({ status: "leased", lastError, updatedAt: now })
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "running"),
        ),
      );
    return "retry";
  }

  /** Terminal transition guarded by lease id so stale queue messages are inert. */
  public async failJobAndEnrollmentForLease(
    jobId: string,
    leaseId: string,
    lastError: string,
    now: string,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({
        enrollmentId: automationJobs.enrollmentId,
        workspaceId: automationJobs.workspaceId,
        status: automationJobs.status,
      })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          inArray(automationJobs.status, ["leased", "running"]),
        ),
      )
      .get();
    if (!row || (row.status !== "leased" && row.status !== "running")) return false;
    assertAutomationJobTransition(row.status, "failed");
    const orm = this.database.orm;
    const [, jobResult] = await orm.batch([
      orm
        .update(automationEnrollments)
        .set({ status: "failed", currentNodeId: null, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(automationEnrollments.workspaceId, row.workspaceId),
            eq(automationEnrollments.id, row.enrollmentId),
            eq(automationEnrollments.status, "active"),
            exists(
              orm
                .select({ id: automationJobs.id })
                .from(automationJobs)
                .where(
                  and(
                    eq(automationJobs.id, jobId),
                    eq(automationJobs.leaseId, leaseId),
                    eq(automationJobs.status, row.status),
                  ),
                ),
            ),
          ),
        ),
      orm
        .update(automationJobs)
        .set({
          status: "failed",
          leaseId: null,
          leaseUntil: null,
          waitEventType: null,
          waitResourceId: null,
          lastError: lastError.slice(0, 2_000),
          updatedAt: now,
        })
        .where(
          and(
            eq(automationJobs.id, jobId),
            eq(automationJobs.leaseId, leaseId),
            eq(automationJobs.status, row.status),
          ),
        ),
    ]);
    return jobResult.meta.changes === 1;
  }
}
