import { and, eq, exists, inArray, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { WorkspaceContext } from "@openengage/core/shared";

import { member } from "../auth/schema";
import type { Database } from "../client";
import { conditionalAudit } from "./project-brief-persistence";
import { projectBriefs, projectItems, projects } from "./schema";

export interface ApprovedProjectLink {
  projectId: string;
  briefRevision: number;
  addedByUserId: string;
}

export interface ProjectLinkedResource {
  resourceType: string;
  resourceId: string;
}

export class ProjectBriefLinkConflictError extends Error {
  public override readonly name = "ProjectBriefLinkConflictError";

  public constructor() {
    super("The approved project brief changed before resources could be linked");
  }
}

/**
 * Repository readers are also used by workers with a workspace-only scope.
 * Brief-linked writes, however, require the authenticated user carried by an
 * HTTP WorkspaceContext; a workspace-only repository therefore resolves to a
 * non-user sentinel and cannot satisfy the SQL guard.
 */
export function authenticatedProjectActorId(context: { workspaceId: string }): string {
  const userId = (context as { userId?: unknown }).userId;
  return typeof userId === "string" && userId.length > 0 ? userId : "";
}

/** The authoritative DB-side guard shared by all brief-derived resource creation. */
export function approvedProjectLinkPrecondition(
  orm: Database,
  workspaceId: string,
  actorUserId: string,
  link: ApprovedProjectLink,
) {
  const activeMarketer = orm
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.userId, link.addedByUserId),
        inArray(member.role, ["owner", "admin", "marketer"]),
      ),
    );
  const activeAdministrator = orm
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.userId, link.addedByUserId),
        inArray(member.role, ["owner", "admin"]),
      ),
    );
  return orm
    .select({ projectId: projectBriefs.projectId })
    .from(projectBriefs)
    .innerJoin(
      projects,
      and(
        eq(projects.workspaceId, projectBriefs.workspaceId),
        eq(projects.id, projectBriefs.projectId),
      ),
    )
    .where(
      and(
        link.addedByUserId === actorUserId ? undefined : sql`0`,
        eq(projectBriefs.workspaceId, workspaceId),
        eq(projectBriefs.projectId, link.projectId),
        eq(projectBriefs.status, "approved"),
        eq(projectBriefs.revision, link.briefRevision),
        isNull(projects.archivedAt),
        or(
          and(eq(projectBriefs.ownerUserId, link.addedByUserId), exists(activeMarketer)),
          exists(activeAdministrator),
        ),
      ),
    );
}

/** Project items for resources linked under an approved brief, inserted only while `precondition` holds. */
export function insertApprovedProjectItems(
  orm: Database,
  workspaceId: string,
  link: ApprovedProjectLink,
  resources: readonly ProjectLinkedResource[],
  precondition: SQLWrapper,
  now: string,
) {
  return orm.insert(projectItems).select(
    sql`SELECT
      ${workspaceId},
      ${link.projectId},
      json_extract(resource_row.value, '$.resourceType'),
      json_extract(resource_row.value, '$.resourceId'),
      ${link.briefRevision}, ${link.addedByUserId}, ${now}
    FROM json_each(${JSON.stringify(resources)}) AS resource_row
    WHERE ${exists(precondition)}`,
  );
}

/** Bumps the brief's rowVersion after a link change, only while every guard holds. */
export function bumpProjectBriefRowVersion(
  orm: Database,
  workspaceId: string,
  projectId: string,
  guards: readonly SQL[],
  now: string,
) {
  return orm
    .update(projectBriefs)
    .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
    .where(
      and(
        eq(projectBriefs.workspaceId, workspaceId),
        eq(projectBriefs.projectId, projectId),
        ...guards,
      ),
    );
}

/**
 * Everything a create under an approved brief writes after the resource itself:
 * the project items, the create and `project.item.add` audits, and the brief
 * rowVersion bump, each guarded by `precondition` in the caller's batch.
 */
export function approvedProjectLinkStatements(
  orm: Database,
  context: Pick<WorkspaceContext, "workspaceId"> & Partial<Pick<WorkspaceContext, "apiKeyId">>,
  link: ApprovedProjectLink,
  precondition: SQLWrapper,
  created: {
    action: string;
    resourceType: string;
    resourceId: string;
    /** Linked resources; defaults to the created resource alone. */
    items?: readonly ProjectLinkedResource[];
    /** `project.item.add` audit metadata; defaults to the created resource and brief revision. */
    linkMetadata?: Record<string, unknown>;
  },
  now: string,
) {
  const { action, resourceType, resourceId } = created;
  return [
    insertApprovedProjectItems(
      orm,
      context.workspaceId,
      link,
      created.items ?? [{ resourceType, resourceId }],
      precondition,
      now,
    ),
    conditionalAudit(
      orm,
      context,
      link.addedByUserId,
      { action, resourceType, resourceId },
      precondition,
      now,
    ),
    conditionalAudit(
      orm,
      context,
      link.addedByUserId,
      {
        action: "project.item.add",
        resourceType: "project",
        resourceId: link.projectId,
        metadata: created.linkMetadata ?? {
          resourceType,
          resourceId,
          briefRevision: link.briefRevision,
        },
      },
      precondition,
      now,
    ),
    bumpProjectBriefRowVersion(
      orm,
      context.workspaceId,
      link.projectId,
      [exists(precondition)],
      now,
    ),
  ];
}
