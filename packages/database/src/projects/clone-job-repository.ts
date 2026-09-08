import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  projectCloneResourceSchema,
  type ProjectCloneJob,
  type ProjectCloneOptions,
  type ProjectCloneReferenceMap,
} from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { ProjectCloneMaterializationRepository } from "./clone-materialization-repository";
import { prepareProjectCloneRow } from "./clone-prepare";
import { ProjectCloneQueryRepository } from "./clone-query-repository";
import { projectCloneJobs, projectCloneMappings } from "./clone-schema";
import { ProjectCloneError, type ProjectCloneCapture } from "./clone-types";

export class ProjectCloneJobRepository extends WorkspaceRepository {
  private jobScope(id: string) {
    return and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.id, id));
  }

  public async createPreview(
    capture: ProjectCloneCapture,
    userId: string,
  ): Promise<ProjectCloneJob> {
    let totalBytes = 0;
    for (const snapshot of capture.snapshots) {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot.row)).byteLength;
      totalBytes += bytes;
      if (bytes > 800_000 || totalBytes > 8_000_000)
        throw new ProjectCloneError(
          "invalid",
          "複製内容が上限を超えています（1設定800KB・全体8MB）",
        );
    }
    const id = uuidv7(),
      now = nowIso(),
      orm = this.database.orm;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm.insert(projectCloneJobs).values({
        id,
        workspaceId: this.context.workspaceId,
        sourceProjectId: capture.sourceProjectId,
        targetProjectId: capture.targetProjectId,
        createdByUserId: userId,
        options: JSON.stringify(capture.options),
        sharedReferences: JSON.stringify(capture.sharedReferences),
        referenceMap: JSON.stringify(capture.referenceMap),
        createdAt: now,
        updatedAt: now,
      }),
    ];
    for (const [ordinal, snapshot] of capture.snapshots.entries())
      statements.push(
        orm.insert(projectCloneMappings).values({
          jobId: id,
          ordinal,
          kind: snapshot.resource.kind,
          sourceId: snapshot.resource.sourceId,
          targetId: snapshot.resource.targetId,
          metadata: JSON.stringify(snapshot.resource),
          sourceRow: JSON.stringify(snapshot.row),
        }),
      );
    await orm.batch(statements);
    return (await new ProjectCloneQueryRepository(this.database, this.context).get(id))!;
  }

  public async start(id: string, requestKey: string): Promise<ProjectCloneJob> {
    const existing = await this.database.orm
      .select({ id: projectCloneJobs.id })
      .from(projectCloneJobs)
      .where(and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.requestKey, requestKey)))
      .get();
    if (existing && existing.id !== id)
      throw new ProjectCloneError("conflict", "この要求キーは別の複製に使用されています");
    const result = await this.database.orm
      .update(projectCloneJobs)
      .set({ status: "queued", requestKey, updatedAt: nowIso() })
      .where(
        and(
          this.jobScope(id),
          eq(projectCloneJobs.status, "preview"),
          isNull(projectCloneJobs.requestKey),
        ),
      )
      .returning({ id: projectCloneJobs.id })
      .get();
    const job = await new ProjectCloneQueryRepository(this.database, this.context).get(id);
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    if (!result && !existing) {
      const current = await this.database.orm
        .select({ requestKey: projectCloneJobs.requestKey })
        .from(projectCloneJobs)
        .where(this.jobScope(id))
        .get();
      if (current?.requestKey !== requestKey)
        throw new ProjectCloneError("conflict", "複製は別の要求で開始済みです");
    }
    return job;
  }

  public async retry(id: string): Promise<ProjectCloneJob> {
    await this.database.orm
      .update(projectCloneJobs)
      .set({ status: "queued", error: null, leaseId: null, leaseUntil: null, updatedAt: nowIso() })
      .where(and(this.jobScope(id), eq(projectCloneJobs.status, "failed")));
    const job = await new ProjectCloneQueryRepository(this.database, this.context).get(id);
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    return job;
  }

  /** Each invocation stages a bounded chunk. The next queue delivery resumes at the first unstaged row. */
  public async process(id: string, chunkSize = 20): Promise<"continue" | "completed" | "busy"> {
    const orm = this.database.orm,
      now = nowIso(),
      leaseId = uuidv7();
    const row = await orm
      .update(projectCloneJobs)
      .set({
        status: "running",
        leaseId,
        leaseUntil: new Date(Date.now() + 120_000).toISOString(),
        updatedAt: now,
      })
      .where(
        and(
          this.jobScope(id),
          or(
            eq(projectCloneJobs.status, "queued"),
            and(eq(projectCloneJobs.status, "running"), lte(projectCloneJobs.leaseUntil, now)),
          ),
        ),
      )
      .returning()
      .get();
    if (!row)
      return (await new ProjectCloneQueryRepository(this.database, this.context).progress(id))
        ?.status === "completed"
        ? "completed"
        : "busy";
    const guard = and(
      this.jobScope(id),
      eq(projectCloneJobs.status, "running"),
      eq(projectCloneJobs.leaseId, leaseId),
    );
    try {
      const options = JSON.parse(row.options) as ProjectCloneOptions;
      const referenceMap = JSON.parse(row.referenceMap) as ProjectCloneReferenceMap;
      const pending = await orm
        .select()
        .from(projectCloneMappings)
        .where(and(eq(projectCloneMappings.jobId, id), isNull(projectCloneMappings.targetRow)))
        .orderBy(asc(projectCloneMappings.ordinal))
        .limit(Math.max(1, Math.min(chunkSize, 30)));
      for (const item of pending) {
        const resource = projectCloneResourceSchema.parse(JSON.parse(item.metadata));
        const target = prepareProjectCloneRow(
          resource,
          JSON.parse(item.sourceRow) as Record<string, unknown>,
          referenceMap,
          options,
          row.createdAt,
        );
        await orm
          .update(projectCloneMappings)
          .set({ targetRow: JSON.stringify(target) })
          .where(
            and(
              eq(projectCloneMappings.jobId, id),
              eq(projectCloneMappings.ordinal, item.ordinal),
              isNull(projectCloneMappings.targetRow),
              sql`EXISTS (SELECT 1 FROM ${projectCloneJobs} WHERE ${projectCloneJobs.id} = ${id} AND ${projectCloneJobs.leaseId} = ${leaseId} AND ${projectCloneJobs.status} = 'running')`,
            ),
          );
      }
      const remaining = await orm
        .select({ ordinal: projectCloneMappings.ordinal })
        .from(projectCloneMappings)
        .where(and(eq(projectCloneMappings.jobId, id), isNull(projectCloneMappings.targetRow)))
        .limit(1);
      if (remaining.length) {
        await orm
          .update(projectCloneJobs)
          .set({ status: "queued", leaseId: null, leaseUntil: null, updatedAt: nowIso() })
          .where(guard);
        return "continue";
      }
      await new ProjectCloneMaterializationRepository(this.database, this.context).materialize(
        id,
        leaseId,
      );
      return "completed";
    } catch (error) {
      await orm
        .update(projectCloneJobs)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 2000) : "複製に失敗しました",
          leaseId: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        })
        .where(guard);
      throw error;
    }
  }
}

export class ProjectCloneRecoveryRepository extends DatabaseRepository {
  public async due(now: string) {
    return this.database.orm
      .select({ id: projectCloneJobs.id, workspaceId: projectCloneJobs.workspaceId })
      .from(projectCloneJobs)
      .where(
        or(
          eq(projectCloneJobs.status, "queued"),
          and(eq(projectCloneJobs.status, "running"), lte(projectCloneJobs.leaseUntil, now)),
        ),
      )
      .orderBy(asc(projectCloneJobs.updatedAt))
      .limit(50);
  }
}
