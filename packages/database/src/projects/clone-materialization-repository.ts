import { and, asc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { projectCloneResourceSchema, type ProjectCloneJob } from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { projectCloneReferenceGuard } from "./clone-reference-repository";
import { projectCloneWrites, projectCloneWriteOrder } from "./clone-resource-writes";
import { projectCloneJobs, projectCloneMappings } from "./clone-schema";
import { ProjectCloneError } from "./clone-types";
import { projectItems } from "./schema";

export class ProjectCloneMaterializationRepository extends WorkspaceRepository {
  private jobScope(id: string) {
    return and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.id, id));
  }
  public async materialize(id: string, leaseId: string): Promise<void> {
    const orm = this.database.orm;
    const job = await orm
      .select({
        targetProjectId: projectCloneJobs.targetProjectId,
        createdByUserId: projectCloneJobs.createdByUserId,
        sharedReferences: projectCloneJobs.sharedReferences,
      })
      .from(projectCloneJobs)
      .where(this.jobScope(id))
      .get();
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    const mappings = await orm
      .select({
        kind: projectCloneMappings.kind,
        metadata: projectCloneMappings.metadata,
        targetRow: projectCloneMappings.targetRow,
      })
      .from(projectCloneMappings)
      .where(eq(projectCloneMappings.jobId, id))
      .orderBy(asc(projectCloneMappings.ordinal));
    const sharedReferences = JSON.parse(
      job.sharedReferences,
    ) as ProjectCloneJob["sharedReferences"];
    // A failed check violates the status constraint and rolls back the entire D1 batch.
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm
        .update(projectCloneJobs)
        .set({
          status: sql`CASE WHEN ${projectCloneJobs.status} = 'running' AND ${projectCloneJobs.leaseId} = ${leaseId} AND ${projectCloneJobs.leaseUntil} > ${nowIso()} THEN 'running' ELSE 'invalid' END`,
        })
        .where(this.jobScope(id)),
    ];
    // D1 permits 100 bound parameters per statement, including statements within a batch.
    for (let offset = 0; offset < sharedReferences.length; offset += 20) {
      const guards = sharedReferences
        .slice(offset, offset + 20)
        .map((ref) => projectCloneReferenceGuard(this.context.workspaceId, ref));
      statements.push(
        orm
          .update(projectCloneJobs)
          .set({
            status: sql`CASE WHEN ${sql.join(guards, sql` AND `)} THEN 'running' ELSE 'invalid' END`,
          })
          .where(this.jobScope(id)),
      );
    }
    mappings.sort(
      (a, b) =>
        projectCloneWriteOrder[projectCloneResourceSchema.shape.kind.parse(a.kind)] -
        projectCloneWriteOrder[projectCloneResourceSchema.shape.kind.parse(b.kind)],
    );
    const briefWrites: BatchItem<"sqlite">[] = [];
    for (const mapping of mappings) {
      if (!mapping.targetRow)
        throw new ProjectCloneError("invalid", "複製の準備が完了していません");
      const row = JSON.parse(mapping.targetRow) as Record<string, unknown>;
      if (row.workspaceId !== this.context.workspaceId)
        throw new ProjectCloneError("invalid", "複製のWorkspaceが一致しません");
      const kind = projectCloneResourceSchema.shape.kind.parse(mapping.kind);
      const statement = projectCloneWrites[kind](orm, row);
      if (kind === "brief") briefWrites.push(statement);
      else statements.push(statement);
    }
    for (const mapping of mappings) {
      const metadata = projectCloneResourceSchema.parse(JSON.parse(mapping.metadata));
      if (metadata.linked)
        statements.push(
          orm.insert(projectItems).values({
            workspaceId: this.context.workspaceId,
            projectId: job.targetProjectId,
            resourceType: metadata.kind,
            resourceId: metadata.targetId,
            briefRevision: null,
            addedByUserId: job.createdByUserId,
            createdAt: nowIso(),
          }),
        );
    }
    // Create the initial links before the draft brief. The approved-revision link
    // trigger still protects subsequent edits; this entire setup commits atomically.
    statements.push(...briefWrites);
    statements.push(
      orm
        .update(projectCloneJobs)
        .set({
          status: "completed",
          completedAt: nowIso(),
          updatedAt: nowIso(),
          leaseId: null,
          leaseUntil: null,
          error: null,
        })
        .where(this.jobScope(id)),
    );
    await orm.batch(statements);
  }
}
