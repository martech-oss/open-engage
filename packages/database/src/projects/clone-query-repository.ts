import { and, asc, desc, eq, lt, ne, or, sql } from "drizzle-orm";

import {
  projectCloneJobSchema,
  projectCloneSummarySchema,
  type ProjectCloneCursor,
  type ProjectClonePage,
} from "@openengage/core/projects";

import { WorkspaceRepository } from "../shared/repository-base";
import { projectCloneJobs as jobs, projectCloneMappings as mappings } from "./clone-schema";
const summaryFields = {
  id: jobs.id,
  sourceProjectId: jobs.sourceProjectId,
  targetProjectId: jobs.targetProjectId,
  name: sql<string>`json_extract(${jobs.options},'$.name')`,
  status: jobs.status,
  error: jobs.error,
  createdAt: jobs.createdAt,
  updatedAt: jobs.updatedAt,
  completedAt: jobs.completedAt,
  totalCount: sql<number>`count(${mappings.ordinal})`,
  preparedCount: sql<number>`sum(CASE WHEN ${mappings.targetRow} IS NOT NULL THEN 1 ELSE 0 END)`,
};
export class ProjectCloneQueryRepository extends WorkspaceRepository {
  async list(
    projectId: string,
    input: { limit?: number; cursor?: ProjectCloneCursor | undefined } = {},
  ): Promise<ProjectClonePage> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const cursor = input.cursor;
    const found = await this.database.orm
      .select(summaryFields)
      .from(jobs)
      .leftJoin(mappings, eq(mappings.jobId, jobs.id))
      .where(
        and(
          this.inWorkspace(jobs),
          eq(jobs.sourceProjectId, projectId),
          ne(jobs.status, "preview"),
          cursor
            ? or(
                lt(jobs.createdAt, cursor.createdAt),
                and(eq(jobs.createdAt, cursor.createdAt), lt(jobs.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .groupBy(jobs.id)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit + 1);
    const items = found.slice(0, limit).map((row) => projectCloneSummarySchema.parse(row));
    const last = items.at(-1);
    return {
      items,
      nextCursor: found.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
  async progress(id: string) {
    const row = await this.database.orm
      .select(summaryFields)
      .from(jobs)
      .leftJoin(mappings, eq(mappings.jobId, jobs.id))
      .where(and(this.inWorkspace(jobs), eq(jobs.id, id)))
      .groupBy(jobs.id)
      .get();
    return row ? projectCloneSummarySchema.parse(row) : null;
  }
  async get(id: string) {
    const row = await this.database.orm
      .select({
        id: jobs.id,
        sourceProjectId: jobs.sourceProjectId,
        targetProjectId: jobs.targetProjectId,
        options: jobs.options,
        sharedReferences: jobs.sharedReferences,
        status: jobs.status,
        error: jobs.error,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        completedAt: jobs.completedAt,
      })
      .from(jobs)
      .where(and(this.inWorkspace(jobs), eq(jobs.id, id)))
      .get();
    if (!row) return null;
    const resources = await this.database.orm
      .select({
        metadata: mappings.metadata,
        prepared: sql<number>`${mappings.targetRow} IS NOT NULL`,
      })
      .from(mappings)
      .where(eq(mappings.jobId, id))
      .orderBy(asc(mappings.ordinal));
    return projectCloneJobSchema.parse({
      ...row,
      options: JSON.parse(row.options),
      sharedReferences: JSON.parse(row.sharedReferences),
      resources: resources.map((resource) => JSON.parse(resource.metadata)),
      totalCount: resources.length,
      preparedCount: resources.filter((resource) => resource.prepared).length,
    });
  }
}
