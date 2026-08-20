import { and, eq, exists, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { WorkspaceContext } from "@openengage/core/shared";

import { member } from "../auth/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { projectBriefRevisionAuditMetadata } from "./project-brief-persistence";
import { projectBriefs, projects } from "./schema";

export class ProjectBriefCommandGuards extends WorkspaceRepository<WorkspaceContext> {
  public briefPrecondition(
    projectId: string,
    input: {
      statuses: string[];
      expectedRowVersion?: number | undefined;
      ownerActor?: boolean | undefined;
      approverActor?: boolean | undefined;
      ownerOrAdminActor?: boolean | undefined;
      adminActor?: boolean | undefined;
      validateCurrentMembers?: boolean | undefined;
      validateAssignedMembers?: { ownerUserId: string; approverUserId: string } | undefined;
    },
  ) {
    const admin = this.context.role === "owner" || this.context.role === "admin";
    const liveAdministrator = exists(this.administrativeMember(this.context.userId));
    const ownerActorCondition = and(
      eq(projectBriefs.ownerUserId, this.context.userId),
      exists(this.eligibleMember(this.context.userId)),
    );
    const approverActorCondition = and(
      eq(projectBriefs.approverUserId, this.context.userId),
      exists(this.eligibleMember(this.context.userId)),
    );
    const assigned = input.validateAssignedMembers;
    return this.database.orm
      .select({ projectId: projectBriefs.projectId })
      .from(projectBriefs)
      .innerJoin(
        projects,
        and(
          eq(projects.id, projectBriefs.projectId),
          eq(projects.workspaceId, projectBriefs.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          isNull(projects.archivedAt),
          inArray(projectBriefs.status, input.statuses),
          input.expectedRowVersion === undefined
            ? undefined
            : eq(projectBriefs.rowVersion, input.expectedRowVersion),
          input.ownerActor ? ownerActorCondition : undefined,
          input.approverActor ? approverActorCondition : undefined,
          input.ownerOrAdminActor ? (admin ? liveAdministrator : ownerActorCondition) : undefined,
          input.adminActor ? (admin ? liveAdministrator : sql`0`) : undefined,
          input.validateCurrentMembers
            ? and(
                exists(this.eligibleMember(projectBriefs.ownerUserId)),
                exists(this.eligibleMember(projectBriefs.approverUserId)),
              )
            : undefined,
          assigned
            ? and(
                ne(sql`${assigned.ownerUserId}`, assigned.approverUserId),
                exists(this.eligibleMember(assigned.ownerUserId)),
                exists(this.eligibleMember(assigned.approverUserId)),
              )
            : undefined,
        ),
      );
  }

  public briefMutationWhere(
    projectId: string,
    precondition: ReturnType<typeof this.briefPrecondition>,
  ) {
    return and(
      this.inWorkspace(projectBriefs),
      eq(projectBriefs.projectId, projectId),
      exists(precondition),
    );
  }

  public eligibleMember(userId: string | AnySQLiteColumn) {
    return this.database.orm
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          sql`${member.userId} = ${userId}`,
          inArray(member.role, ["owner", "admin", "marketer"]),
        ),
      );
  }

  public administrativeMember(userId: string) {
    return this.database.orm
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          eq(member.userId, userId),
          inArray(member.role, ["owner", "admin"]),
        ),
      );
  }

  public async assignedMembersAreEligible(
    ownerUserId: string,
    approverUserId: string,
  ): Promise<boolean> {
    if (ownerUserId === approverUserId) return false;
    const rows = await this.database.orm
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          inArray(member.userId, [ownerUserId, approverUserId]),
          inArray(member.role, ["owner", "admin", "marketer"]),
        ),
      );
    return new Set(rows.map((row) => row.userId)).size === 2;
  }

  public async isEligibleMember(userId: string): Promise<boolean> {
    return Boolean(await this.eligibleMember(userId).get());
  }

  public async currentAssignedMembersAreEligible(projectId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({
        ownerUserId: projectBriefs.ownerUserId,
        approverUserId: projectBriefs.approverUserId,
      })
      .from(projectBriefs)
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          eq(projectBriefs.status, "draft"),
        ),
      )
      .get();
    return row ? this.assignedMembersAreEligible(row.ownerUserId, row.approverUserId) : true;
  }

  public revisionAuditMetadata(
    projectId: string,
    additional: Record<string, string | number | boolean | null> = {},
  ) {
    return projectBriefRevisionAuditMetadata(this.context.workspaceId, projectId, additional);
  }
}
