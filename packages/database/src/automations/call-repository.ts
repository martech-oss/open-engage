import { and, asc, eq, ne, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  automationExecutionSnapshotSchema,
  type AutomationDependency,
  type AutomationExecutionSnapshot,
} from "@openengage/core/automations";
import { variableSnapshotSchema } from "@openengage/core/projects";

import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { runningActionLeaseExists } from "./action-authority";
import type { AutomationJobRow } from "./engine-support";
import {
  automations,
  automationVersions,
  automationEnrollments,
  automationJobs,
  automationActionEffects,
} from "./schema";

export class AutomationPublicationRepository extends WorkspaceRepository {
  public async publishedDependency(id: string): Promise<AutomationDependency | null> {
    const row = await this.database.orm
      .select({ version: automationVersions })
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
          eq(automations.id, id),
          ne(automations.status, "archived"),
        ),
      )
      .get();
    if (!row) return null;
    const version = row.version;
    const graph = automationDefinitionSchema.parse(JSON.parse(version.graph));
    return {
      automationId: id,
      versionId: version.id,
      sourceGraph: graph,
      graph,
      variableSnapshot: version.variableSnapshot
        ? variableSnapshotSchema.parse(JSON.parse(version.variableSnapshot))
        : null,
      dependencies: automationExecutionSnapshotSchema.parse({
        graph,
        variableSnapshot: null,
        dependencies: JSON.parse(version.dependencies),
      }).dependencies,
    };
  }
}

export class AutomationCallRepository extends DatabaseRepository {
  public async executionSnapshot(
    enrollmentId: string,
    workspaceId: string,
  ): Promise<AutomationExecutionSnapshot> {
    const row = await this.database.orm
      .select({
        enrollmentSnapshot: automationEnrollments.executionSnapshot,
        graph: automationVersions.graph,
        resolvedGraph: automationVersions.resolvedGraph,
        dependencies: automationVersions.dependencies,
        variableSnapshot: automationVersions.variableSnapshot,
      })
      .from(automationEnrollments)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automationEnrollments.automationVersionId),
          eq(automationVersions.workspaceId, automationEnrollments.workspaceId),
        ),
      )
      .where(
        and(
          eq(automationEnrollments.id, enrollmentId),
          eq(automationEnrollments.workspaceId, workspaceId),
        ),
      )
      .get();
    if (!row) throw new Error("Automation execution snapshot missing");
    return automationExecutionSnapshotSchema.parse(
      row.enrollmentSnapshot
        ? JSON.parse(row.enrollmentSnapshot)
        : {
            graph: JSON.parse(row.resolvedGraph ?? row.graph),
            dependencies: JSON.parse(row.dependencies),
            variableSnapshot: row.variableSnapshot ? JSON.parse(row.variableSnapshot) : null,
          },
    );
  }
  public async startChild(
    job: AutomationJobRow,
    leaseId: string,
    mode: "await" | "async",
    now: string,
  ): Promise<{ id: string; status: string; parked: boolean }> {
    const snapshot = await this.executionSnapshot(job.enrollmentId, job.workspaceId),
      dependency = snapshot.dependencies[job.nodeId];
    if (!dependency)
      throw new Error("Pinned callable dependency missing; republish this automation");
    const source = dependency.graph.nodes.find(
      (node) => node.type === "source" && node.config.source === "callable",
    );
    if (!source) throw new Error("Pinned child is not callable");
    const orm = this.database.orm,
      id = uuidv7(),
      childJob = uuidv7();
    const authority = runningActionLeaseExists(this.database, {
      workspaceId: job.workspaceId,
      jobId: job.id,
      leaseId,
    });
    const childSelect = orm
      .select({ id: automationEnrollments.id })
      .from(automationEnrollments)
      .where(
        and(
          eq(automationEnrollments.workspaceId, job.workspaceId),
          eq(automationEnrollments.parentJobId, job.id),
        ),
      );
    await orm.batch([
      orm
        .insert(automationEnrollments)
        .select(
          sql`SELECT ${id},${job.workspaceId},${dependency.automationId},${dependency.versionId},${job.contactId},${`call:${job.id}`},'active',${source.id},${now},NULL,${now},${job.id},${snapshot.graph.variableProjectId ?? null},${JSON.stringify(dependency)} WHERE ${authority}`,
        )
        .onConflictDoNothing(),
      orm
        .insert(automationJobs)
        .select(
          sql`SELECT ${childJob},${job.workspaceId},${id},${dependency.versionId},${source.id},${job.contactId},${`${id}:${source.id}:${job.contactId}`},'{}','pending',${now},NULL,NULL,NULL,NULL,0,NULL,${now},${now} WHERE EXISTS(SELECT 1 FROM ${automationEnrollments} WHERE id=${id})`,
        )
        .onConflictDoNothing(),
      ...(mode === "await"
        ? [
            orm
              .update(automationJobs)
              .set({
                status: "pending",
                dueAt: "9999-12-31T00:00:00.000Z",
                payload: sql`json_set(${automationJobs.payload},'$.waitingChild',(${childSelect}))`,
                leaseId: null,
                leaseUntil: null,
                attempts: 0,
                updatedAt: now,
              })
              .where(
                and(
                  eq(automationJobs.id, job.id),
                  eq(automationJobs.workspaceId, job.workspaceId),
                  eq(automationJobs.status, "running"),
                  eq(automationJobs.leaseId, leaseId),
                  sql`EXISTS(SELECT 1 FROM ${automationEnrollments} child WHERE child.parent_job_id=${job.id} AND child.status='active')`,
                ),
              ),
          ]
        : []),
    ]);
    const child = await orm
      .select({ id: automationEnrollments.id, status: automationEnrollments.status })
      .from(automationEnrollments)
      .where(
        and(
          eq(automationEnrollments.workspaceId, job.workspaceId),
          eq(automationEnrollments.parentJobId, job.id),
        ),
      )
      .get();
    if (!child) throw new Error("Callable parent no longer active");
    return { ...child, parked: mode === "await" && child.status === "active" };
  }
  public async claimChildFailures(now: string, limit = 100) {
    const rows = await this.database.orm.all<{
      workspaceId: string;
      parentJobId: string;
      parentNodeId: string;
      parentEnrollmentId: string;
      childId: string;
      mode: string;
    }>(
      sql`SELECT child.workspace_id AS workspaceId,j.id AS parentJobId,j.node_id AS parentNodeId,j.enrollment_id AS parentEnrollmentId,child.id AS childId,json_extract(n.value,'$.config.mode') AS mode FROM ${automationEnrollments} child JOIN ${automationJobs} j ON j.id=child.parent_job_id JOIN ${automationVersions} v ON v.id=j.automation_version_id JOIN json_each(v.graph,'$.nodes') n ON json_extract(n.value,'$.id')=j.node_id WHERE child.status='failed' AND NOT EXISTS(SELECT 1 FROM ${automationActionEffects} a WHERE a.job_id=j.id AND a.effect='call_failure_reported') ORDER BY child.updated_at LIMIT ${limit}`,
    );
    const claimed: typeof rows = [];
    for (const row of rows) {
      const result = await this.database.orm
        .insert(automationActionEffects)
        .values({
          workspaceId: row.workspaceId,
          jobId: row.parentJobId,
          nodeId: row.parentNodeId,
          effect: "call_failure_reported",
          completedAt: now,
        })
        .onConflictDoNothing();
      if (result.meta.changes === 1) claimed.push(row);
    }
    return claimed;
  }
  public async recover(now: string, limit = 100): Promise<number> {
    const rows = await this.database.orm
      .select({ id: automationJobs.id, status: automationEnrollments.status })
      .from(automationJobs)
      .innerJoin(
        automationEnrollments,
        and(
          eq(automationEnrollments.parentJobId, automationJobs.id),
          eq(automationEnrollments.workspaceId, automationJobs.workspaceId),
        ),
      )
      .where(
        and(
          eq(automationJobs.status, "pending"),
          ne(automationEnrollments.status, "active"),
          sql`json_extract(${automationJobs.payload},'$.waitingChild')=${automationEnrollments.id}`,
          sql`json_extract(${automationJobs.payload},'$.childOutcome') IS NULL`,
        ),
      )
      .orderBy(asc(automationJobs.updatedAt))
      .limit(limit);
    for (const row of rows)
      await this.database.orm
        .update(automationJobs)
        .set({
          payload: sql`json_set(${automationJobs.payload},'$.childOutcome',${row.status})`,
          dueAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(automationJobs.id, row.id),
            eq(automationJobs.status, "pending"),
            sql`json_extract(${automationJobs.payload},'$.childOutcome') IS NULL`,
          ),
        );
    return rows.length;
  }
}
