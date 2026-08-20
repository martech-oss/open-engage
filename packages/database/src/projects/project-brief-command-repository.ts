import { and, eq, exists, isNull, ne, sql } from "drizzle-orm";

import type { ProjectBriefMutation } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { auditLogs } from "../platform/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { ProjectBriefCommandGuards } from "./project-brief-command-guards";
import {
  conditionalProjectAudit,
  encodeBriefDefinition,
  type ProjectAuditInput,
} from "./project-brief-persistence";
import { insertProjectBriefVersionStatement } from "./project-brief-version-statement";
import { projectBriefReviews, projectBriefs, projects } from "./schema";

export type ProjectBriefCommandOutcome =
  | { kind: "done" }
  | { kind: "conflict" }
  | { kind: "invalid_member" }
  | { kind: "forbidden_actor" };

export interface ExpectedBriefVersion {
  expectedRowVersion?: number | undefined;
}

export class ProjectBriefCommandRepository extends WorkspaceRepository<WorkspaceContext> {
  private readonly guards = new ProjectBriefCommandGuards(this.database, this.context);
  public async createBrief(
    input: ProjectBriefMutation,
  ): Promise<
    { kind: "done"; id: string } | { kind: "invalid_member" } | { kind: "forbidden_actor" }
  > {
    const id = uuidv7();
    const now = nowIso();
    const definition = encodeBriefDefinition(input.definition);
    const membersAreEligible = and(
      ne(sql`${input.ownerUserId}`, input.approverUserId),
      exists(this.guards.eligibleMember(input.ownerUserId)),
      exists(this.guards.eligibleMember(input.approverUserId)),
    );
    const createPrecondition = and(
      exists(this.guards.eligibleMember(this.context.userId)),
      membersAreEligible,
    );
    const insertProject = this.database.orm.insert(projects).select(
      sql`SELECT
        ${id}, ${this.context.workspaceId}, ${input.name}, ${input.description}, ${input.color},
        NULL, ${now}, ${now}
      WHERE ${createPrecondition}`,
    );
    const insertBrief = this.database.orm.insert(projectBriefs).select(
      sql`SELECT
        ${id}, ${this.context.workspaceId}, 'draft', 1, 1,
        ${input.ownerUserId}, ${input.approverUserId}, ${input.primaryMotion}, ${input.reviewAt},
        ${definition}, NULL, NULL, NULL, NULL, ${now}, ${now}
      FROM ${projects}
      WHERE ${projects.workspaceId} = ${this.context.workspaceId}
        AND ${projects.id} = ${id}
        AND ${createPrecondition}`,
    );
    const insertAudit = this.database.orm.insert(auditLogs).select(
      sql`SELECT
        ${uuidv7()}, ${this.context.workspaceId}, ${this.context.userId},
        ${this.context.apiKeyId ?? null}, 'project.brief.create', 'project', ${id},
        '{"revision":1}', NULL, ${now}
      FROM ${projectBriefs}
      WHERE ${projectBriefs.workspaceId} = ${this.context.workspaceId}
        AND ${projectBriefs.projectId} = ${id}`,
    );
    const [, briefResult] = await this.database.orm.batch([
      insertProject,
      insertBrief,
      insertAudit,
    ]);
    if (briefResult.meta.changes === 1) return { kind: "done", id };
    return (await this.guards.isEligibleMember(this.context.userId))
      ? { kind: "invalid_member" }
      : { kind: "forbidden_actor" };
  }

  public async updateBrief(
    projectId: string,
    input: ProjectBriefMutation & ExpectedBriefVersion,
  ): Promise<ProjectBriefCommandOutcome> {
    if (!(await this.guards.assignedMembersAreEligible(input.ownerUserId, input.approverUserId))) {
      return { kind: "invalid_member" };
    }
    const now = nowIso();
    const precondition = this.guards.briefPrecondition(projectId, {
      statuses: ["draft"],
      expectedRowVersion: input.expectedRowVersion,
      ownerActor: true,
      validateAssignedMembers: {
        ownerUserId: input.ownerUserId,
        approverUserId: input.approverUserId,
      },
    });
    const [projectResult, , briefResult] = await this.database.orm.batch([
      this.database.orm
        .update(projects)
        .set({
          name: input.name,
          description: input.description,
          color: input.color,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(projects), eq(projects.id, projectId), exists(precondition))),
      conditionalProjectAudit(
        this.database.orm,
        this.context,
        {
          action: "project.brief.update",
          projectId,
          metadataSql: this.guards.revisionAuditMetadata(projectId),
        },
        precondition,
        now,
      ),
      this.database.orm
        .update(projectBriefs)
        .set({
          ownerUserId: input.ownerUserId,
          approverUserId: input.approverUserId,
          primaryMotion: input.primaryMotion,
          reviewAt: input.reviewAt,
          definition: encodeBriefDefinition(input.definition),
          rowVersion: sql`${projectBriefs.rowVersion} + 1`,
          updatedAt: now,
        })
        .where(this.guards.briefMutationWhere(projectId, precondition)),
    ]);
    if (briefResult.meta.changes === 1 && projectResult.meta.changes === 1) {
      return { kind: "done" };
    }
    return { kind: "conflict" };
  }

  public async submit(
    projectId: string,
    input: ExpectedBriefVersion,
  ): Promise<ProjectBriefCommandOutcome> {
    if (!(await this.guards.currentAssignedMembersAreEligible(projectId))) {
      return { kind: "invalid_member" };
    }
    return this.transition({
      projectId,
      statuses: ["draft"],
      expectedRowVersion: input.expectedRowVersion,
      ownerActor: true,
      validateCurrentMembers: true,
      audit: {
        action: "project.brief.submit",
        projectId,
        metadataSql: this.guards.revisionAuditMetadata(projectId),
      },
      set: {
        status: "pending_approval",
        submittedAt: nowIso(),
      },
    });
  }

  public async withdraw(
    projectId: string,
    input: ExpectedBriefVersion & { reason: string },
  ): Promise<ProjectBriefCommandOutcome> {
    return this.transition({
      projectId,
      statuses: ["pending_approval"],
      expectedRowVersion: input.expectedRowVersion,
      ownerOrAdminActor: true,
      audit: {
        action: "project.brief.withdraw",
        projectId,
        metadataSql: this.guards.revisionAuditMetadata(projectId, { reason: input.reason }),
      },
      set: { status: "draft", submittedAt: null },
    });
  }

  public async review(
    projectId: string,
    input: ExpectedBriefVersion & {
      decision: "approved" | "rejected";
      comment: string;
    },
  ): Promise<ProjectBriefCommandOutcome> {
    if (!(await this.guards.isEligibleMember(this.context.userId))) {
      return { kind: "forbidden_actor" };
    }
    const now = nowIso();
    const precondition = this.guards.briefPrecondition(projectId, {
      statuses: ["pending_approval"],
      expectedRowVersion: input.expectedRowVersion,
      approverActor: true,
    });
    const insertReview = this.database.orm.insert(projectBriefReviews).select(
      sql`SELECT
        ${uuidv7()},
        ${this.context.workspaceId},
        ${projectId},
        ${projectBriefs.revision},
        ${this.context.userId},
        ${input.decision},
        ${input.comment},
        ${now}
      FROM ${projectBriefs}
      WHERE ${projectBriefs.workspaceId} = ${this.context.workspaceId}
        AND ${projectBriefs.projectId} = ${projectId}
        AND ${exists(precondition)}`,
    );
    const audit = conditionalProjectAudit(
      this.database.orm,
      this.context,
      {
        action: `project.brief.${input.decision}`,
        projectId,
        metadataSql: this.guards.revisionAuditMetadata(projectId, { comment: input.comment }),
      },
      precondition,
      now,
    );
    const update = this.database.orm
      .update(projectBriefs)
      .set({
        status: input.decision === "approved" ? "approved" : "draft",
        approvedAt: input.decision === "approved" ? now : null,
        approvedByUserId: input.decision === "approved" ? this.context.userId : null,
        ...(input.decision === "rejected" ? { submittedAt: null } : {}),
        rowVersion: sql`${projectBriefs.rowVersion} + 1`,
        updatedAt: now,
      })
      .where(this.guards.briefMutationWhere(projectId, precondition));

    if (input.decision === "approved") {
      const [, , , result] = await this.database.orm.batch([
        insertReview,
        insertProjectBriefVersionStatement(
          this.database.orm,
          this.context.workspaceId,
          projectId,
          precondition,
          now,
          this.context.userId,
          now,
        ),
        audit,
        update,
      ]);
      return result.meta.changes === 1 ? { kind: "done" } : { kind: "conflict" };
    }
    const [, , result] = await this.database.orm.batch([insertReview, audit, update]);
    return result.meta.changes === 1 ? { kind: "done" } : { kind: "conflict" };
  }

  public async reopen(
    projectId: string,
    input: ExpectedBriefVersion,
  ): Promise<ProjectBriefCommandOutcome> {
    const now = nowIso();
    const precondition = this.guards.briefPrecondition(projectId, {
      statuses: ["approved", "completed"],
      expectedRowVersion: input.expectedRowVersion,
      ownerOrAdminActor: true,
    });
    const [, , result] = await this.database.orm.batch([
      insertProjectBriefVersionStatement(
        this.database.orm,
        this.context.workspaceId,
        projectId,
        precondition,
        now,
      ),
      conditionalProjectAudit(
        this.database.orm,
        this.context,
        {
          action: "project.brief.reopen",
          projectId,
          metadataSql: this.guards.revisionAuditMetadata(projectId),
        },
        precondition,
        now,
      ),
      this.database.orm
        .update(projectBriefs)
        .set({
          status: "draft",
          revision: sql`${projectBriefs.revision} + 1`,
          rowVersion: sql`${projectBriefs.rowVersion} + 1`,
          submittedAt: null,
          approvedAt: null,
          approvedByUserId: null,
          completedAt: null,
          updatedAt: now,
        })
        .where(this.guards.briefMutationWhere(projectId, precondition)),
    ]);
    return result.meta.changes === 1 ? { kind: "done" } : { kind: "conflict" };
  }

  public async complete(
    projectId: string,
    input: ExpectedBriefVersion,
  ): Promise<ProjectBriefCommandOutcome> {
    const now = nowIso();
    return this.transition({
      projectId,
      statuses: ["approved"],
      expectedRowVersion: input.expectedRowVersion,
      ownerOrAdminActor: true,
      audit: {
        action: "project.brief.complete",
        projectId,
        metadataSql: this.guards.revisionAuditMetadata(projectId),
      },
      set: { status: "completed", completedAt: now },
      now,
    });
  }

  public async archive(
    projectId: string,
    input: ExpectedBriefVersion,
  ): Promise<ProjectBriefCommandOutcome> {
    const now = nowIso();
    const precondition = this.guards.briefPrecondition(projectId, {
      statuses: ["draft", "pending_approval", "approved", "completed"],
      expectedRowVersion: input.expectedRowVersion,
      adminActor: true,
    });
    const [, result] = await this.database.orm.batch([
      conditionalProjectAudit(
        this.database.orm,
        this.context,
        {
          action: "project.brief.archive",
          projectId,
          metadataSql: this.guards.revisionAuditMetadata(projectId),
        },
        precondition,
        now,
      ),
      this.database.orm
        .update(projects)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            this.inWorkspace(projects),
            eq(projects.id, projectId),
            isNull(projects.archivedAt),
            exists(precondition),
          ),
        ),
    ]);
    return result.meta.changes === 1 ? { kind: "done" } : { kind: "conflict" };
  }

  private async transition(input: {
    projectId: string;
    statuses: string[];
    expectedRowVersion?: number | undefined;
    ownerActor?: boolean | undefined;
    approverActor?: boolean | undefined;
    ownerOrAdminActor?: boolean | undefined;
    validateCurrentMembers?: boolean | undefined;
    audit: ProjectAuditInput;
    set: Partial<typeof projectBriefs.$inferInsert>;
    now?: string | undefined;
  }): Promise<ProjectBriefCommandOutcome> {
    const now = input.now ?? nowIso();
    const precondition = this.guards.briefPrecondition(input.projectId, input);
    const [, result] = await this.database.orm.batch([
      conditionalProjectAudit(this.database.orm, this.context, input.audit, precondition, now),
      this.database.orm
        .update(projectBriefs)
        .set({
          ...input.set,
          rowVersion: sql`${projectBriefs.rowVersion} + 1`,
          updatedAt: now,
        })
        .where(this.guards.briefMutationWhere(input.projectId, precondition)),
    ]);
    return result.meta.changes === 1 ? { kind: "done" } : { kind: "conflict" };
  }
}
