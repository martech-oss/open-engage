import { and, eq, exists, inArray, isNull, notExists, sql } from "drizzle-orm";

import { type ProjectResourceType } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { member } from "../auth/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { conditionalProjectAudit, uniqueOperationIso } from "./project-brief-persistence";
import type { ProjectResourceLinkOutcome } from "./project-resource-link-types";
import { ProjectResourceQueryRepository } from "./project-resource-query-repository";
import { createProjectResourceResolverRegistry } from "./project-resource-resolvers";
import { projectBriefs, projectItems, projects } from "./schema";

export class ProjectResourceCommandRepository extends WorkspaceRepository<WorkspaceContext> {
  private readonly queries = new ProjectResourceQueryRepository(this.database, this.context);
  private readonly resources = createProjectResourceResolverRegistry(
    this.database,
    this.context.workspaceId,
  );

  public async addApproved(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  }): Promise<ProjectResourceLinkOutcome> {
    if (!(await this.queries.isAvailable(input.resourceType, input.resourceId))) {
      return { kind: "resource_not_found" };
    }
    const now = uniqueOperationIso();
    const base = this.approvedActorPrecondition(input.projectId, input.expectedRowVersion);
    const currentLink = this.database.orm
      .select({ resourceId: projectItems.resourceId })
      .from(projectItems)
      .innerJoin(
        projectBriefs,
        and(
          eq(projectBriefs.workspaceId, projectItems.workspaceId),
          eq(projectBriefs.projectId, projectItems.projectId),
          eq(projectBriefs.revision, projectItems.briefRevision),
        ),
      )
      .where(
        and(
          this.inWorkspace(projectItems),
          eq(projectItems.projectId, input.projectId),
          eq(projectItems.resourceType, input.resourceType),
          eq(projectItems.resourceId, input.resourceId),
        ),
      );
    const changePrecondition = this.database.orm
      .select({ projectId: projectBriefs.projectId })
      .from(projectBriefs)
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, input.projectId),
          exists(base),
          notExists(currentLink),
          this.resources[input.resourceType].availableCondition(input.resourceId),
        ),
      );
    const marker = this.database.orm
      .select({ resourceId: projectItems.resourceId })
      .from(projectItems)
      .where(
        and(
          this.inWorkspace(projectItems),
          eq(projectItems.projectId, input.projectId),
          eq(projectItems.resourceType, input.resourceType),
          eq(projectItems.resourceId, input.resourceId),
          eq(projectItems.addedByUserId, this.context.userId),
          eq(projectItems.createdAt, now),
        ),
      );
    const [, , , briefResult] = await this.database.orm.batch([
      conditionalProjectAudit(
        this.database.orm,
        this.context,
        {
          action: "project.item.add",
          projectId: input.projectId,
          metadataSql: this.resourceAuditMetadata(input),
        },
        changePrecondition,
        now,
      ),
      this.database.orm
        .update(projectItems)
        .set({
          briefRevision: sql`(
            SELECT ${projectBriefs.revision}
            FROM ${projectBriefs}
            WHERE ${projectBriefs.workspaceId} = ${this.context.workspaceId}
              AND ${projectBriefs.projectId} = ${input.projectId}
          )`,
          addedByUserId: this.context.userId,
          createdAt: now,
        })
        .where(
          and(
            this.inWorkspace(projectItems),
            eq(projectItems.projectId, input.projectId),
            eq(projectItems.resourceType, input.resourceType),
            eq(projectItems.resourceId, input.resourceId),
            exists(changePrecondition),
          ),
        ),
      this.database.orm
        .insert(projectItems)
        .select(
          sql`SELECT
            ${this.context.workspaceId},
            ${input.projectId},
            ${input.resourceType},
            ${input.resourceId},
            ${projectBriefs.revision},
            ${this.context.userId},
            ${now}
          FROM ${projectBriefs}
          WHERE ${projectBriefs.workspaceId} = ${this.context.workspaceId}
            AND ${projectBriefs.projectId} = ${input.projectId}
            AND ${exists(changePrecondition)}`,
        )
        .onConflictDoNothing(),
      this.database.orm
        .update(projectBriefs)
        .set({
          rowVersion: sql`${projectBriefs.rowVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(projectBriefs),
            eq(projectBriefs.projectId, input.projectId),
            exists(base),
            exists(marker),
          ),
        ),
    ]);
    if (briefResult.meta.changes === 1) {
      return {
        kind: "done",
        changed: true,
      };
    }
    if (!(await base.get())) return { kind: "conflict" };
    if (await this.queries.linkExists(input)) {
      return {
        kind: "done",
        changed: false,
      };
    }
    return { kind: "conflict" };
  }

  public async removeApproved(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  }): Promise<ProjectResourceLinkOutcome> {
    // `updatedAt` doubles as a per-operation capability marker for the delete
    // later in the same D1 batch.  In particular, this prevents an actor who
    // fails `approvedActorPrecondition` from deleting the item when legacy
    // clients omit `expectedRowVersion`.
    const now = uniqueOperationIso();
    const base = this.approvedActorPrecondition(input.projectId, input.expectedRowVersion);
    const postUpdateBase = this.approvedActorPrecondition(
      input.projectId,
      input.expectedRowVersion === undefined ? undefined : input.expectedRowVersion + 1,
    );
    const item = this.database.orm
      .select({ resourceId: projectItems.resourceId })
      .from(projectItems)
      .where(
        and(
          this.inWorkspace(projectItems),
          eq(projectItems.projectId, input.projectId),
          eq(projectItems.resourceType, input.resourceType),
          eq(projectItems.resourceId, input.resourceId),
        ),
      );
    const removePrecondition = this.database.orm
      .select({ projectId: projectBriefs.projectId })
      .from(projectBriefs)
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, input.projectId),
          exists(base),
          exists(item),
        ),
      );
    const [, , result] = await this.database.orm.batch([
      conditionalProjectAudit(
        this.database.orm,
        this.context,
        {
          action: "project.item.remove",
          projectId: input.projectId,
          metadataSql: this.resourceAuditMetadata(input),
        },
        removePrecondition,
        now,
      ),
      this.database.orm
        .update(projectBriefs)
        .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
        .where(
          and(
            this.inWorkspace(projectBriefs),
            eq(projectBriefs.projectId, input.projectId),
            exists(removePrecondition),
          ),
        ),
      this.database.orm.delete(projectItems).where(
        and(
          this.inWorkspace(projectItems),
          eq(projectItems.projectId, input.projectId),
          eq(projectItems.resourceType, input.resourceType),
          eq(projectItems.resourceId, input.resourceId),
          exists(
            this.database.orm
              .select({ projectId: projectBriefs.projectId })
              .from(projectBriefs)
              .where(
                and(
                  this.inWorkspace(projectBriefs),
                  eq(projectBriefs.projectId, input.projectId),
                  eq(projectBriefs.status, "approved"),
                  eq(projectBriefs.updatedAt, now),
                  exists(postUpdateBase),
                ),
              ),
          ),
        ),
      ),
    ]);
    if (result.meta.changes === 1) return { kind: "done", changed: true };
    if (!(await base.get())) return { kind: "conflict" };
    return (await this.queries.linkExists(input))
      ? { kind: "conflict" }
      : { kind: "done", changed: false };
  }

  private approvedActorPrecondition(projectId: string, expectedRowVersion?: number) {
    const admin = this.context.role === "owner" || this.context.role === "admin";
    const activeActor = this.database.orm
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          eq(member.userId, this.context.userId),
          inArray(member.role, admin ? ["owner", "admin"] : ["owner", "admin", "marketer"]),
        ),
      );
    return this.database.orm
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
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          eq(projectBriefs.status, "approved"),
          isNull(projects.archivedAt),
          expectedRowVersion === undefined
            ? undefined
            : eq(projectBriefs.rowVersion, expectedRowVersion),
          exists(activeActor),
          admin ? undefined : eq(projectBriefs.ownerUserId, this.context.userId),
        ),
      );
  }

  private resourceAuditMetadata(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
  }) {
    return sql`json_object(
      'briefRevision', (
        SELECT ${projectBriefs.revision}
        FROM ${projectBriefs}
        WHERE ${projectBriefs.workspaceId} = ${this.context.workspaceId}
          AND ${projectBriefs.projectId} = ${input.projectId}
      ),
      'resourceType', ${input.resourceType},
      'resourceId', ${input.resourceId}
    )`;
  }
}
