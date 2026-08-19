import { exists, sql, type SQLWrapper } from "drizzle-orm";

import type { Database } from "../client";
import { projectBriefs, projectBriefVersions, projects } from "./schema";

/** Immutable approved-revision snapshot guarded by the caller's CAS predicate. */
export function insertProjectBriefVersionStatement(
  orm: Database,
  workspaceId: string,
  projectId: string,
  precondition: SQLWrapper,
  now: string,
  approvedByUserId?: string,
  approvedAt?: string,
) {
  return orm
    .insert(projectBriefVersions)
    .select(
      sql`SELECT
        ${projectBriefs.workspaceId},
        ${projectBriefs.projectId},
        ${projectBriefs.revision},
        ${projects.name},
        ${projects.description},
        ${projects.color},
        ${projectBriefs.ownerUserId},
        ${projectBriefs.approverUserId},
        ${projectBriefs.primaryMotion},
        ${projectBriefs.reviewAt},
        ${projectBriefs.definition},
        COALESCE(${approvedByUserId ?? null}, ${projectBriefs.approvedByUserId}, ${projectBriefs.approverUserId}),
        COALESCE(${approvedAt ?? null}, ${projectBriefs.approvedAt}, ${projectBriefs.updatedAt}),
        ${now}
      FROM ${projectBriefs}
      INNER JOIN ${projects}
        ON ${projects.workspaceId} = ${projectBriefs.workspaceId}
        AND ${projects.id} = ${projectBriefs.projectId}
      WHERE ${projectBriefs.workspaceId} = ${workspaceId}
        AND ${projectBriefs.projectId} = ${projectId}
        AND ${exists(precondition)}`,
    )
    .onConflictDoNothing();
}
