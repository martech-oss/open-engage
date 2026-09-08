import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import {
  automationJobs,
  automationEnrollments,
  automationRuns,
  automationRunTargets,
} from "./schema";

export class AutomationExecutionRepository extends WorkspaceRepository {
  private descendants(root: SQL): SQL {
    return sql`WITH RECURSIVE tree(id) AS (${root} UNION SELECT e.id FROM ${automationEnrollments} e JOIN ${automationJobs} j ON j.id=e.parent_job_id JOIN tree p ON p.id=j.enrollment_id WHERE e.workspace_id=${this.context.workspaceId}) SELECT id FROM tree`;
  }
  private cancelStatements(root: SQL, now: string) {
    const tree = this.descendants(root),
      orm = this.database.orm;
    return [
      orm
        .update(automationJobs)
        .set({ status: "cancelled", leaseId: null, leaseUntil: null, updatedAt: now })
        .where(
          and(
            this.inWorkspace(automationJobs),
            sql`${automationJobs.enrollmentId} IN (${tree})`,
            inArray(automationJobs.status, ["pending", "leased", "queued", "running"]),
          ),
        ),
      orm
        .update(automationEnrollments)
        .set({ status: "cancelled", completedAt: now, updatedAt: now })
        .where(
          and(
            this.inWorkspace(automationEnrollments),
            sql`${automationEnrollments.id} IN (${tree})`,
            eq(automationEnrollments.status, "active"),
          ),
        ),
    ];
  }
  public async cancelEnrollment(id: string) {
    const found = await this.database.orm
      .select({ id: automationEnrollments.id })
      .from(automationEnrollments)
      .where(and(this.inWorkspace(automationEnrollments), eq(automationEnrollments.id, id)))
      .get();
    if (!found) return false;
    const [first, ...rest] = this.cancelStatements(
      sql`SELECT id FROM ${automationEnrollments} WHERE workspace_id=${this.context.workspaceId} AND id=${id}`,
      nowIso(),
    );
    await this.database.orm.batch([first!, ...rest]);
    return true;
  }
  public async cancelRunTree(runId: string) {
    const now = nowIso(),
      orm = this.database.orm;
    await orm.batch([
      orm
        .update(automationRuns)
        .set({ status: "cancelled", completedAt: now, updatedAt: now })
        .where(
          and(
            this.inWorkspace(automationRuns),
            eq(automationRuns.id, runId),
            inArray(automationRuns.status, ["enrolling", "running"]),
          ),
        ),
      ...this.cancelStatements(
        sql`SELECT enrollment_id AS id FROM ${automationRunTargets} WHERE workspace_id=${this.context.workspaceId} AND run_id=${runId} AND enrollment_id IS NOT NULL`,
        now,
      ),
      orm
        .update(automationRunTargets)
        .set({ status: "skipped", reason: "cancelled", updatedAt: now })
        .where(
          and(
            this.inWorkspace(automationRunTargets),
            eq(automationRunTargets.runId, runId),
            eq(automationRunTargets.status, "pending"),
          ),
        ),
    ]);
  }
  public async listEnrollments(automationId: string) {
    return this.database.orm
      .select({
        id: automationEnrollments.id,
        automationId: automationEnrollments.automationId,
        contactId: automationEnrollments.contactId,
        status: automationEnrollments.status,
        enteredAt: automationEnrollments.enteredAt,
        completedAt: automationEnrollments.completedAt,
        parentJobId: automationEnrollments.parentJobId,
        lastError: sql<
          string | null
        >`(SELECT last_error FROM ${automationJobs} j WHERE j.enrollment_id=${sql.raw("automation_enrollments.id")} AND j.last_error IS NOT NULL ORDER BY j.updated_at DESC LIMIT 1)`,
      })
      .from(automationEnrollments)
      .where(
        and(
          this.inWorkspace(automationEnrollments),
          eq(automationEnrollments.automationId, automationId),
        ),
      )
      .orderBy(desc(automationEnrollments.enteredAt))
      .limit(100);
  }
  public async enrollmentDetail(id: string) {
    const row = await this.database.orm
      .select()
      .from(automationEnrollments)
      .where(and(this.inWorkspace(automationEnrollments), eq(automationEnrollments.id, id)))
      .get();
    if (!row) return null;
    const [jobs, children] = await Promise.all([
      this.database.orm
        .select({
          id: automationJobs.id,
          nodeId: automationJobs.nodeId,
          status: automationJobs.status,
          dueAt: automationJobs.dueAt,
          attempts: automationJobs.attempts,
          lastError: automationJobs.lastError,
          payload: automationJobs.payload,
        })
        .from(automationJobs)
        .where(and(this.inWorkspace(automationJobs), eq(automationJobs.enrollmentId, id)))
        .orderBy(asc(automationJobs.createdAt)),
      this.database.orm
        .select({
          id: automationEnrollments.id,
          automationId: automationEnrollments.automationId,
          automationVersionId: automationEnrollments.automationVersionId,
          status: automationEnrollments.status,
          parentJobId: automationEnrollments.parentJobId,
          enteredAt: automationEnrollments.enteredAt,
          completedAt: automationEnrollments.completedAt,
        })
        .from(automationEnrollments)
        .where(
          and(
            this.inWorkspace(automationEnrollments),
            sql`${automationEnrollments.parentJobId} IN (SELECT id FROM ${automationJobs} WHERE enrollment_id=${id})`,
          ),
        ),
    ]);
    return { ...row, jobs, children };
  }
}
