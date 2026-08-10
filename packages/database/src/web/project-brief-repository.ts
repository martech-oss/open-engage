import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  marketingAutomationBriefDefinitionSchema,
  projectBriefDetailSchema,
  projectBriefSummarySchema,
  projectLinkedResourceSchema,
  projectMemberOptionSchema,
  type MarketingMotion,
  type ProjectBriefDetail,
  type ProjectBriefMutation,
  type ProjectBriefStatus,
  type ProjectBriefSummary,
  type ProjectLinkedResource,
  type ProjectMemberOption,
  type ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { member, user } from "../auth/schema";
import { automations } from "../automations/schema";
import { emailTemplates } from "../messaging/schema";
import { auditLogs } from "../platform/schema";
import { segments } from "../segments/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import {
  forms,
  landingPages,
  projectBriefReviews,
  projectBriefs,
  projectItems,
  projects,
} from "./schema";

const briefCodec = defineJsonCodec(
  marketingAutomationBriefDefinitionSchema,
  "project_briefs.definition",
);

export interface ProjectBriefRecord {
  projectId: string;
  status: ProjectBriefStatus;
  revision: number;
  ownerUserId: string;
  approverUserId: string;
  primaryMotion: MarketingMotion;
  reviewAt: string;
}

export type ProjectBriefWriteOutcome =
  | { kind: "done" }
  | { kind: "not_found" }
  | { kind: "invalid_status" }
  | { kind: "invalid_member" }
  | { kind: "same_reviewer" };

export type ProjectBriefItemOutcome =
  | { kind: "done"; added: boolean }
  | { kind: "project_not_found" }
  | { kind: "brief_not_approved" }
  | { kind: "resource_not_found" };

export class ProjectBriefRepository extends WorkspaceRepository<WorkspaceContext> {
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
    const members = await this.memberMap();
    return rows.map((row) =>
      projectBriefSummarySchema.parse({
        ...row,
        status: row.status,
        primaryMotion: row.primaryMotion,
        ownerName: members.get(row.ownerUserId)?.name ?? "Unknown member",
        approverName: members.get(row.approverUserId)?.name ?? "Unknown member",
      }),
    );
  }

  public async getBrief(projectId: string): Promise<ProjectBriefDetail | null> {
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
    const [members, reviewRows, auditRows, itemRows] = await Promise.all([
      this.memberMap(),
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
      this.listItems(projectId, row.revision),
    ]);
    return projectBriefDetailSchema.parse({
      project: {
        ...row,
        itemCount: itemRows.length,
        ownerName: members.get(row.ownerUserId)?.name ?? "Unknown member",
        approverName: members.get(row.approverUserId)?.name ?? "Unknown member",
      },
      definition: briefCodec.decode(row.definition),
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      completedAt: row.completedAt,
      reviews: reviewRows.map((review) => ({
        ...review,
        reviewerName: members.get(review.reviewerUserId)?.name ?? "Unknown member",
      })),
      audit: auditRows.map((event) => ({
        ...event,
        actorName: event.actorUserId
          ? (members.get(event.actorUserId)?.name ?? "Unknown member")
          : "System",
      })),
      items: itemRows,
    });
  }

  public async findRecord(projectId: string): Promise<ProjectBriefRecord | null> {
    const row = await this.database.orm
      .select({
        projectId: projectBriefs.projectId,
        status: projectBriefs.status,
        revision: projectBriefs.revision,
        ownerUserId: projectBriefs.ownerUserId,
        approverUserId: projectBriefs.approverUserId,
        primaryMotion: projectBriefs.primaryMotion,
        reviewAt: projectBriefs.reviewAt,
      })
      .from(projectBriefs)
      .innerJoin(projects, eq(projects.id, projectBriefs.projectId))
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

  public async createBrief(input: ProjectBriefMutation): Promise<{ id: string }> {
    await this.assertMembers(input.ownerUserId, input.approverUserId);
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.batch([
      this.database.orm.insert(projects).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        description: input.description,
        color: input.color,
        createdAt: now,
        updatedAt: now,
      }),
      this.database.orm.insert(projectBriefs).values({
        projectId: id,
        workspaceId: this.context.workspaceId,
        status: "draft",
        revision: 1,
        ownerUserId: input.ownerUserId,
        approverUserId: input.approverUserId,
        primaryMotion: input.primaryMotion,
        reviewAt: input.reviewAt,
        definition: briefCodec.encode(input.definition),
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    return { id };
  }

  public async updateBrief(
    projectId: string,
    input: ProjectBriefMutation,
  ): Promise<ProjectBriefWriteOutcome> {
    const record = await this.findRecord(projectId);
    if (!record) return { kind: "not_found" };
    if (record.status !== "draft") return { kind: "invalid_status" };
    try {
      await this.assertMembers(input.ownerUserId, input.approverUserId);
    } catch (error) {
      if (error instanceof SameReviewerError) return { kind: "same_reviewer" };
      return { kind: "invalid_member" };
    }
    const now = nowIso();
    await this.database.orm.batch([
      this.database.orm
        .update(projects)
        .set({
          name: input.name,
          description: input.description,
          color: input.color,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(projects), eq(projects.id, projectId))),
      this.database.orm
        .update(projectBriefs)
        .set({
          ownerUserId: input.ownerUserId,
          approverUserId: input.approverUserId,
          primaryMotion: input.primaryMotion,
          reviewAt: input.reviewAt,
          definition: briefCodec.encode(input.definition),
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(projectBriefs),
            eq(projectBriefs.projectId, projectId),
            eq(projectBriefs.status, "draft"),
          ),
        ),
    ]);
    return { kind: "done" };
  }

  public async setPending(projectId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(projectBriefs)
      .set({ status: "pending_approval", submittedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          eq(projectBriefs.status, "draft"),
        ),
      );
    return changedExactlyOne(result);
  }

  public async review(
    projectId: string,
    input: { decision: "approved" | "rejected"; comment: string },
  ): Promise<boolean> {
    const record = await this.findRecord(projectId);
    if (!record || record.status !== "pending_approval") return false;
    const now = nowIso();
    const nextStatus = input.decision === "approved" ? "approved" : "draft";
    await this.database.orm.batch([
      this.database.orm.insert(projectBriefReviews).values({
        id: uuidv7(),
        workspaceId: this.context.workspaceId,
        projectId,
        revision: record.revision,
        reviewerUserId: this.context.userId,
        decision: input.decision,
        comment: input.comment,
        createdAt: now,
      }),
      this.database.orm
        .update(projectBriefs)
        .set({
          status: nextStatus,
          approvedAt: input.decision === "approved" ? now : null,
          approvedByUserId: input.decision === "approved" ? this.context.userId : null,
          ...(input.decision === "rejected" ? { submittedAt: null } : {}),
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(projectBriefs),
            eq(projectBriefs.projectId, projectId),
            eq(projectBriefs.status, "pending_approval"),
          ),
        ),
    ]);
    return true;
  }

  public async reopen(projectId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(projectBriefs)
      .set({
        status: "draft",
        revision: sql`${projectBriefs.revision} + 1`,
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          inArray(projectBriefs.status, ["approved", "completed"]),
        ),
      );
    return changedExactlyOne(result);
  }

  public async complete(projectId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(projectBriefs)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          eq(projectBriefs.status, "approved"),
        ),
      );
    return changedExactlyOne(result);
  }

  public async archive(projectId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(projects)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(this.inWorkspace(projects), eq(projects.id, projectId), isNull(projects.archivedAt)),
      );
    return changedExactlyOne(result);
  }

  public async addApprovedItem(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
  }): Promise<ProjectBriefItemOutcome> {
    const brief = await this.findRecord(input.projectId);
    if (!brief) return { kind: "project_not_found" };
    if (brief.status !== "approved") return { kind: "brief_not_approved" };
    if (!(await this.resourceExists(input.resourceType, input.resourceId))) {
      return { kind: "resource_not_found" };
    }
    const result = await this.database.orm
      .insert(projectItems)
      .values({
        workspaceId: this.context.workspaceId,
        projectId: input.projectId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        briefRevision: brief.revision,
        addedByUserId: this.context.userId,
        createdAt: nowIso(),
      })
      .onConflictDoNothing();
    return { kind: "done", added: result.meta.changes === 1 };
  }

  public async removeItem(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .delete(projectItems)
      .where(
        and(
          this.inWorkspace(projectItems),
          eq(projectItems.projectId, input.projectId),
          eq(projectItems.resourceType, input.resourceType),
          eq(projectItems.resourceId, input.resourceId),
        ),
      );
    return changedExactlyOne(result);
  }

  private async listItems(projectId: string, revision: number): Promise<ProjectLinkedResource[]> {
    const rows = await this.database.orm
      .select({
        resourceType: projectItems.resourceType,
        resourceId: projectItems.resourceId,
        briefRevision: projectItems.briefRevision,
        createdAt: projectItems.createdAt,
      })
      .from(projectItems)
      .where(and(this.inWorkspace(projectItems), eq(projectItems.projectId, projectId)))
      .orderBy(desc(projectItems.createdAt));
    const resolved = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await this.resolveResource(row.resourceType as ProjectResourceType, row.resourceId)),
      })),
    );
    return resolved.flatMap((row) =>
      row.name
        ? [
            projectLinkedResourceSchema.parse({
              ...row,
              stale: row.briefRevision !== revision,
            }),
          ]
        : [],
    );
  }

  private async memberMap(): Promise<Map<string, ProjectMemberOption>> {
    return new Map((await this.eligibleMembers()).map((item) => [item.id, item]));
  }

  private async assertMembers(ownerUserId: string, approverUserId: string): Promise<void> {
    if (ownerUserId === approverUserId) throw new SameReviewerError();
    const ids = new Set((await this.eligibleMembers()).map((item) => item.id));
    if (!ids.has(ownerUserId) || !ids.has(approverUserId)) throw new Error("Invalid member");
  }

  private async resourceExists(type: ProjectResourceType, id: string): Promise<boolean> {
    return Boolean((await this.resolveResource(type, id)).name);
  }

  private async resolveResource(
    type: ProjectResourceType,
    id: string,
  ): Promise<{ name: string | null; status: string | null }> {
    const workspaceId = this.context.workspaceId;
    if (type === "automation") {
      const row = await this.database.orm
        .select({ name: automations.name, status: automations.status })
        .from(automations)
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
        .get();
      return row && row.status !== "archived" ? row : { name: null, status: null };
    }
    if (type === "email") {
      const row = await this.database.orm
        .select({
          name: emailTemplates.name,
          archivedAt: emailTemplates.archivedAt,
          publishedAt: emailTemplates.publishedAt,
        })
        .from(emailTemplates)
        .where(and(eq(emailTemplates.workspaceId, workspaceId), eq(emailTemplates.id, id)))
        .get();
      return row && !row.archivedAt
        ? { name: row.name, status: row.publishedAt ? "published" : "draft" }
        : { name: null, status: null };
    }
    if (type === "segment") {
      const row = await this.database.orm
        .select({ name: segments.name, status: segments.evaluationStatus })
        .from(segments)
        .where(and(eq(segments.workspaceId, workspaceId), eq(segments.id, id)))
        .get();
      return row ?? { name: null, status: null };
    }
    if (type === "form") {
      const row = await this.database.orm
        .select({ name: forms.name, status: forms.status })
        .from(forms)
        .where(and(eq(forms.workspaceId, workspaceId), eq(forms.id, id)))
        .get();
      return row && row.status !== "archived" ? row : { name: null, status: null };
    }
    const row = await this.database.orm
      .select({ name: landingPages.name, status: landingPages.status })
      .from(landingPages)
      .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, id)))
      .get();
    return row && row.status !== "archived" ? row : { name: null, status: null };
  }
}

class SameReviewerError extends Error {}
