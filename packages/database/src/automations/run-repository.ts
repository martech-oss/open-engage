import { and, asc, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";

import {
  automationDefinitionSchema,
  automationRunSchema,
  type AutomationAudience,
} from "@openengage/core/automations";

import { contacts } from "../contacts/schema";
import { compileWorkspaceSegmentFilter } from "../segments/program-filter-repository";
import { segments, segmentMemberships } from "../segments/schema";
import { compiledFilterSql } from "../segments/support";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { AutomationExecutionRepository } from "./execution-repository";
import {
  automations,
  automationVersions,
  automationRuns,
  automationRunTargets,
  automationEnrollments,
} from "./schema";

export class AutomationRunRepository extends WorkspaceRepository {
  private audienceQuery(audience: AutomationAudience): SQL {
    if (audience.kind === "filter")
      return compiledFilterSql(
        compileWorkspaceSegmentFilter(this.context.workspaceId, audience.filter),
      );
    return sql`SELECT c.* FROM ${contacts} c JOIN ${segmentMemberships} m ON m.workspace_id=c.workspace_id AND m.contact_id=c.id JOIN ${segments} s ON s.workspace_id=m.workspace_id AND s.id=m.segment_id WHERE c.workspace_id=${this.context.workspaceId} AND m.segment_id=${audience.segmentId} AND s.kind='static'`;
  }
  public async published(automationId: string) {
    const row = await this.database.orm
      .select({
        id: automationVersions.id,
        graph: automationVersions.graph,
        publishedAt: automationVersions.publishedAt,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.publishedVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.id, automationId),
          eq(automations.status, "active"),
        ),
      )
      .get();
    if (!row) throw new Error("公開中のオートメーションがありません");
    const graph = automationDefinitionSchema.parse(JSON.parse(row.graph));
    const source = graph.nodes.find((node) => node.type === "source");
    if (source?.config.source !== "batch") throw new Error("バッチ開始のフローを選択してください");
    return { ...row, graph, source: { ...source, config: source.config } };
  }
  public async preview(audience: AutomationAudience) {
    if (audience.kind === "segment") {
      const segment = await this.database.orm
        .select({ id: segments.id })
        .from(segments)
        .where(
          and(
            this.inWorkspace(segments),
            eq(segments.id, audience.segmentId),
            eq(segments.kind, "static"),
          ),
        )
        .get();
      if (!segment) throw new Error("利用できるリストがありません");
    }
    const query = this.audienceQuery(audience);
    const [count, sample] = await Promise.all([
      this.database.orm.get<{ count: number }>(
        sql`SELECT count(*) AS count FROM (${query}) c WHERE c.status!='archived'`,
      ),
      this.database.orm.all<{ id: string; email: string | null }>(
        sql`SELECT id,email FROM (${query}) c WHERE c.status!='archived' ORDER BY id LIMIT 20`,
      ),
    ]);
    return { count: Number(count?.count ?? 0), sample };
  }
  public async startRun(
    automationId: string,
    slot: string,
    now = nowIso(),
    expectedVersionId?: string,
  ) {
    const existing = await this.database.orm
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          this.inWorkspace(automationRuns),
          eq(automationRuns.automationId, automationId),
          eq(automationRuns.slot, slot),
        ),
      )
      .get();
    if (existing) return (await this.runDetail(existing.id))!.run;
    const version = await this.published(automationId);
    if (expectedVersionId && version.id !== expectedVersionId)
      throw new Error("公開版が変更されました。対象を再確認してください");
    await this.preview(version.source.config.audience);
    const id = uuidv7(),
      orm = this.database.orm,
      workspaceId = this.context.workspaceId;
    const authority = exists(
      orm
        .select({ id: automations.id })
        .from(automations)
        .where(
          and(
            this.inWorkspace(automations),
            eq(automations.id, automationId),
            eq(automations.status, "active"),
            eq(automations.publishedVersionId, version.id),
          ),
        ),
    );
    await orm.batch([
      orm
        .insert(automationRuns)
        .select(
          sql`SELECT ${id},${workspaceId},${automationId},${version.id},${slot},'enrolling',${now},NULL,NULL,${now},NULL WHERE ${authority}`,
        )
        .onConflictDoNothing(),
      orm
        .insert(automationRunTargets)
        .select(
          sql`SELECT ${workspaceId},${id},c.id,'pending',NULL,NULL,NULL,0,${now} FROM (${this.audienceQuery(version.source.config.audience)}) c WHERE c.status!='archived' AND EXISTS(SELECT 1 FROM ${automationRuns} r WHERE r.id=${id})`,
        )
        .onConflictDoNothing(),
    ]);
    const run = await orm
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          this.inWorkspace(automationRuns),
          eq(automationRuns.automationId, automationId),
          eq(automationRuns.slot, slot),
        ),
      )
      .get();
    if (!run) throw new Error("公開状態が変更されました");
    return (await this.runDetail(run.id))!.run;
  }
  public async pendingTargets(runId: string, limit = 100) {
    return this.database.orm
      .select({
        contactId: automationRunTargets.contactId,
        attempts: automationRunTargets.attempts,
      })
      .from(automationRunTargets)
      .innerJoin(
        automationRuns,
        and(
          eq(automationRuns.id, automationRunTargets.runId),
          eq(automationRuns.workspaceId, automationRunTargets.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automationRunTargets),
          eq(automationRunTargets.runId, runId),
          eq(automationRunTargets.status, "pending"),
          eq(automationRuns.status, "enrolling"),
        ),
      )
      .orderBy(asc(automationRunTargets.contactId))
      .limit(limit);
  }
  public async runVersion(runId: string) {
    const row = await this.database.orm
      .select({ run: automationRuns, graph: automationVersions.graph })
      .from(automationRuns)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automationRuns.automationVersionId),
          eq(automationVersions.workspaceId, automationRuns.workspaceId),
        ),
      )
      .where(and(this.inWorkspace(automationRuns), eq(automationRuns.id, runId)))
      .get();
    return row
      ? { ...row.run, graph: automationDefinitionSchema.parse(JSON.parse(row.graph)) }
      : null;
  }
  public async skipTarget(runId: string, contactId: string, reason: string) {
    await this.database.orm
      .update(automationRunTargets)
      .set({ status: "skipped", reason, updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(automationRunTargets),
          eq(automationRunTargets.runId, runId),
          eq(automationRunTargets.contactId, contactId),
          eq(automationRunTargets.status, "pending"),
        ),
      );
  }
  public async failTarget(runId: string, contactId: string, error: string) {
    await this.database.orm
      .update(automationRunTargets)
      .set({
        attempts: sql`${automationRunTargets.attempts}+1`,
        status: sql`CASE WHEN ${automationRunTargets.attempts}>=4 THEN 'failed' ELSE 'pending' END`,
        lastError: error.slice(0, 2000),
        updatedAt: nowIso(),
      })
      .where(
        and(
          this.inWorkspace(automationRunTargets),
          eq(automationRunTargets.runId, runId),
          eq(automationRunTargets.contactId, contactId),
          eq(automationRunTargets.status, "pending"),
        ),
      );
  }
  public async refresh(runId: string, now = nowIso()) {
    const unfinished = sql`EXISTS(SELECT 1 FROM ${automationRunTargets} t WHERE t.run_id=${automationRuns.id} AND t.status='pending')`;
    const flowing = sql`EXISTS(SELECT 1 FROM ${automationRunTargets} t JOIN ${automationEnrollments} e ON e.id=t.enrollment_id WHERE t.run_id=${automationRuns.id} AND e.status='active')`;
    const failed = sql`EXISTS(SELECT 1 FROM ${automationRunTargets} t LEFT JOIN ${automationEnrollments} e ON e.id=t.enrollment_id WHERE t.run_id=${automationRuns.id} AND (t.status='failed' OR e.status='failed'))`;
    await this.database.orm
      .update(automationRuns)
      .set({
        enrollmentCompletedAt: sql`CASE WHEN NOT ${unfinished} THEN coalesce(${automationRuns.enrollmentCompletedAt},${now}) ELSE NULL END`,
        status: sql`CASE WHEN ${unfinished} THEN 'enrolling' WHEN ${flowing} THEN 'running' WHEN ${failed} THEN 'failed' ELSE 'completed' END`,
        completedAt: sql`CASE WHEN NOT ${unfinished} AND NOT ${flowing} THEN coalesce(${automationRuns.completedAt},${now}) ELSE NULL END`,
        updatedAt: now,
      })
      .where(
        and(
          this.inWorkspace(automationRuns),
          eq(automationRuns.id, runId),
          inArray(automationRuns.status, ["enrolling", "running"]),
        ),
      );
  }
  private counts() {
    const count = (predicate: SQL) =>
      sql<number>`(SELECT count(*) FROM ${automationRunTargets} t LEFT JOIN ${automationEnrollments} e ON e.id=t.enrollment_id WHERE t.run_id=${sql.raw("automation_runs.id")} AND ${predicate})`.mapWith(
        Number,
      );
    return {
      targetCount: count(sql`1`),
      pendingCount: count(sql`t.status='pending'`),
      enrolledCount: count(sql`t.status='enrolled'`),
      skippedCount: count(sql`t.status='skipped'`),
      failedCount: count(sql`t.status='failed'`),
      flowCompletedCount: count(sql`e.status='completed'`),
      flowFailedCount: count(sql`e.status='failed'`),
      flowActiveCount: count(sql`e.status='active'`),
    };
  }
  public async listRuns(automationId: string) {
    const rows = await this.database.orm
      .select({ run: automationRuns, ...this.counts() })
      .from(automationRuns)
      .where(and(this.inWorkspace(automationRuns), eq(automationRuns.automationId, automationId)))
      .orderBy(desc(automationRuns.createdAt))
      .limit(50);
    return rows.map(({ run, ...counts }) => automationRunSchema.parse({ ...run, ...counts }));
  }
  public async runDetail(runId: string, cursor?: string, limit = 100) {
    const row = await this.database.orm
      .select({ run: automationRuns, ...this.counts() })
      .from(automationRuns)
      .where(and(this.inWorkspace(automationRuns), eq(automationRuns.id, runId)))
      .get();
    if (!row) return null;
    const targets = await this.database.orm
      .select({
        contactId: automationRunTargets.contactId,
        status: automationRunTargets.status,
        enrollmentId: automationRunTargets.enrollmentId,
        reason: automationRunTargets.reason,
        lastError: automationRunTargets.lastError,
        attempts: automationRunTargets.attempts,
        flowStatus: automationEnrollments.status,
      })
      .from(automationRunTargets)
      .leftJoin(
        automationEnrollments,
        eq(automationEnrollments.id, automationRunTargets.enrollmentId),
      )
      .where(
        and(
          this.inWorkspace(automationRunTargets),
          eq(automationRunTargets.runId, runId),
          ...(cursor ? [sql`${automationRunTargets.contactId}>${cursor}`] : []),
        ),
      )
      .orderBy(asc(automationRunTargets.contactId))
      .limit(limit + 1);
    return {
      run: automationRunSchema.parse({
        ...row.run,
        ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "run")),
      }),
      targets: targets.slice(0, limit),
      nextCursor: targets.length > limit ? targets[limit - 1]!.contactId : null,
    };
  }
  public async cancelRun(runId: string) {
    const run = await this.runVersion(runId);
    if (!run) return false;
    await new AutomationExecutionRepository(this.database, this.context).cancelRunTree(runId);
    return true;
  }
}
