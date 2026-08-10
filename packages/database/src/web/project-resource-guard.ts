import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";

import { member } from "../auth/schema";
import type { Database } from "../client";
import { projectBriefs, projects } from "./schema";

export interface ApprovedProjectLink {
  projectId: string;
  briefRevision: number;
  addedByUserId: string;
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
