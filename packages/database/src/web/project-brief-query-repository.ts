import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  approvedMarketingBriefContextSchema,
  projectBriefDetailSchema,
  projectBriefSummarySchema,
  projectMemberOptionSchema,
  resolveProjectBriefAllowedActions,
  type ApprovedMarketingBriefContext,
  type MarketingCapabilitySnapshot,
  type MarketingMotion,
  type ProjectBriefDetail,
  type ProjectBriefStatus,
  type ProjectBriefSummary,
  type ProjectMemberOption,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { member, user } from "../auth/schema";
import { auditLogs } from "../platform/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { decodeBriefDefinition } from "./project-brief-persistence";
import { ProjectResourceLinkRepository } from "./project-resource-link-repository";
import {
  projectBriefReviews,
  projectBriefs,
  projectBriefVersions,
  projectItems,
  projects,
} from "./schema";

export interface ProjectBriefRecord {
  projectId: string;
  status: ProjectBriefStatus;
  revision: number;
  rowVersion: number;
  ownerUserId: string;
  approverUserId: string;
  primaryMotion: MarketingMotion;
  reviewAt: string;
}

export class ProjectBriefQueryRepository extends WorkspaceRepository<WorkspaceContext> {
  public async listBriefs(): Promise<ProjectBriefSummary[]> {
    const rows = await this.database.orm
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        itemCount: count(projectItems.resourceId),
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        status: projectBriefs.status,
        revision: projectBriefs.revision,
        rowVersion: projectBriefs.rowVersion,
        primaryMotion: projectBriefs.primaryMotion,
        ownerUserId: projectBriefs.ownerUserId,
        approverUserId: projectBriefs.approverUserId,
        reviewAt: projectBriefs.reviewAt,
      })
      .from(projectBriefs)
      .innerJoin(
        projects,
        and(
          eq(projects.id, projectBriefs.projectId),
          eq(projects.workspaceId, projectBriefs.workspaceId),
        ),
      )
      .leftJoin(
        projectItems,
        and(
          eq(projectItems.projectId, projectBriefs.projectId),
          eq(projectItems.workspaceId, projectBriefs.workspaceId),
        ),
      )
      .where(and(this.inWorkspace(projectBriefs), isNull(projects.archivedAt)))
      .groupBy(projectBriefs.projectId)
      .orderBy(desc(projects.updatedAt));
    const names = await this.userNames(
      rows.flatMap((row) => [row.ownerUserId, row.approverUserId]),
    );
    return rows.map((row) =>
      projectBriefSummarySchema.parse({
        ...row,
        ownerName: names.get(row.ownerUserId) ?? "Unknown member",
        approverName: names.get(row.approverUserId) ?? "Unknown member",
      }),
    );
  }

  public async getBrief(
    projectId: string,
    capabilities: MarketingCapabilitySnapshot,
  ): Promise<ProjectBriefDetail | null> {
    const row = await this.database.orm
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        status: projectBriefs.status,
        revision: projectBriefs.revision,
        rowVersion: projectBriefs.rowVersion,
        primaryMotion: projectBriefs.primaryMotion,
        ownerUserId: projectBriefs.ownerUserId,
        approverUserId: projectBriefs.approverUserId,
        reviewAt: projectBriefs.reviewAt,
        definition: projectBriefs.definition,
        submittedAt: projectBriefs.submittedAt,
        approvedAt: projectBriefs.approvedAt,
        completedAt: projectBriefs.completedAt,
      })
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
        ),
      )
      .get();
    if (!row) return null;

    const [reviewRows, auditRows, itemRows] = await Promise.all([
      this.database.orm
        .select({
          id: projectBriefReviews.id,
          revision: projectBriefReviews.revision,
          reviewerUserId: projectBriefReviews.reviewerUserId,
          decision: projectBriefReviews.decision,
          comment: projectBriefReviews.comment,
          createdAt: projectBriefReviews.createdAt,
        })
        .from(projectBriefReviews)
        .where(
          and(this.inWorkspace(projectBriefReviews), eq(projectBriefReviews.projectId, projectId)),
        )
        .orderBy(desc(projectBriefReviews.createdAt)),
      this.database.orm
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorUserId: auditLogs.actorUserId,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            this.inWorkspace(auditLogs),
            eq(auditLogs.resourceType, "project"),
            eq(auditLogs.resourceId, projectId),
          ),
        )
        .orderBy(desc(auditLogs.createdAt)),
      new ProjectResourceLinkRepository(this.database, this.context).list(projectId, row.revision),
    ]);
    const names = await this.userNames([
      row.ownerUserId,
      row.approverUserId,
      ...reviewRows.map((review) => review.reviewerUserId),
      ...auditRows.flatMap((event) => (event.actorUserId ? [event.actorUserId] : [])),
    ]);

    return projectBriefDetailSchema.parse({
      project: {
        ...row,
        itemCount: itemRows.length,
        ownerName: names.get(row.ownerUserId) ?? "Unknown member",
        approverName: names.get(row.approverUserId) ?? "Unknown member",
      },
      rowVersion: row.rowVersion,
      definition: decodeBriefDefinition(row.definition),
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      completedAt: row.completedAt,
      reviews: reviewRows.map((review) => ({
        ...review,
        reviewerName: names.get(review.reviewerUserId) ?? "Unknown member",
      })),
      audit: auditRows.map((event) => ({
        ...event,
        actorName: event.actorUserId
          ? (names.get(event.actorUserId) ?? "Unknown member")
          : "System",
      })),
      items: itemRows,
      allowedActions: resolveProjectBriefAllowedActions(
        {
          status: row.status as ProjectBriefStatus,
          ownerUserId: row.ownerUserId,
          approverUserId: row.approverUserId,
        },
        {
          userId: this.context.userId,
          role: this.context.role,
        },
      ),
      capabilities,
    });
  }

  public async findRecord(projectId: string): Promise<ProjectBriefRecord | null> {
    const row = await this.database.orm
      .select({
        projectId: projectBriefs.projectId,
        status: projectBriefs.status,
        revision: projectBriefs.revision,
        rowVersion: projectBriefs.rowVersion,
        ownerUserId: projectBriefs.ownerUserId,
        approverUserId: projectBriefs.approverUserId,
        primaryMotion: projectBriefs.primaryMotion,
        reviewAt: projectBriefs.reviewAt,
      })
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
        ),
      )
      .get();
    return row as ProjectBriefRecord | null;
  }

  public async getApprovedContext(
    projectId: string,
    revision: number,
  ): Promise<ApprovedMarketingBriefContext | null> {
    const admin = this.context.role === "owner" || this.context.role === "admin";
    const row = await this.database.orm
      .select({
        projectId: projectBriefVersions.projectId,
        revision: projectBriefVersions.revision,
        name: projectBriefVersions.name,
        primaryMotion: projectBriefVersions.primaryMotion,
        definition: projectBriefVersions.definition,
      })
      .from(projectBriefVersions)
      .innerJoin(
        projectBriefs,
        and(
          eq(projectBriefs.workspaceId, projectBriefVersions.workspaceId),
          eq(projectBriefs.projectId, projectBriefVersions.projectId),
          eq(projectBriefs.revision, projectBriefVersions.revision),
        ),
      )
      .innerJoin(
        projects,
        and(
          eq(projects.workspaceId, projectBriefVersions.workspaceId),
          eq(projects.id, projectBriefVersions.projectId),
        ),
      )
      .where(
        and(
          this.inWorkspace(projectBriefVersions),
          eq(projectBriefVersions.projectId, projectId),
          eq(projectBriefVersions.revision, revision),
          eq(projectBriefs.status, "approved"),
          isNull(projects.archivedAt),
          admin ? undefined : eq(projectBriefs.ownerUserId, this.context.userId),
        ),
      )
      .get();
    return row
      ? approvedMarketingBriefContextSchema.parse({
          ...row,
          definition: decodeBriefDefinition(row.definition),
        })
      : null;
  }

  public async eligibleMembers(): Promise<ProjectMemberOption[]> {
    const rows = await this.database.orm
      .select({ id: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          inArray(member.role, ["owner", "admin", "marketer"]),
        ),
      )
      .orderBy(asc(user.name), asc(user.email));
    return rows.map((row) => projectMemberOptionSchema.parse(row));
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.database.orm
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(sql`${user.id} IN (SELECT value FROM json_each(${JSON.stringify(unique)}))`);
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
