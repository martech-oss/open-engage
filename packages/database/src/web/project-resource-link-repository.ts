import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import {
  projectLinkedResourceSchema,
  type ProjectLinkedResource,
  type ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { member } from "../auth/schema";
import { automations } from "../automations/schema";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { conditionalProjectAudit, uniqueOperationIso } from "./project-brief-persistence";
import { forms, landingPages, projectBriefs, projectItems, projects } from "./schema";

interface ResolvedResource {
  name: string;
  status: string | null;
  availability: "available" | "archived" | "missing";
}

export type ProjectResourceLinkOutcome =
  | { kind: "done"; changed: boolean }
  | { kind: "conflict" }
  | { kind: "resource_not_found" };

export class ProjectResourceLinkRepository extends WorkspaceRepository<WorkspaceContext> {
  public async list(projectId: string, revision: number): Promise<ProjectLinkedResource[]> {
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
    const resources = await this.resolveResources(rows);
    return rows.map((row) =>
      projectLinkedResourceSchema.parse({
        ...row,
        ...(resources.get(resourceKey(row.resourceType, row.resourceId)) ?? {
          name: row.resourceId,
          status: null,
          availability: "missing" as const,
        }),
        stale: row.briefRevision !== revision,
      }),
    );
  }

  public async isAvailable(type: ProjectResourceType, id: string): Promise<boolean> {
    return Boolean(await this.readAvailable(type, id));
  }

  public async addApproved(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  }): Promise<ProjectResourceLinkOutcome> {
    if (!(await this.isAvailable(input.resourceType, input.resourceId))) {
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
          this.availableCondition(input.resourceType, input.resourceId),
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
    if (await this.linkExists(input)) {
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
    return (await this.linkExists(input)) ? { kind: "conflict" } : { kind: "done", changed: false };
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

  private availableCondition(type: ProjectResourceType, id: string): SQL {
    if (type === "automation") {
      return exists(
        this.database.orm
          .select({ id: automations.id })
          .from(automations)
          .where(
            and(
              this.inWorkspace(automations),
              eq(automations.id, id),
              ne(automations.status, "archived"),
            ),
          ),
      );
    }
    if (type === "email") {
      return exists(
        this.database.orm
          .select({ id: emailTemplates.id })
          .from(emailTemplates)
          .where(
            and(
              this.inWorkspace(emailTemplates),
              eq(emailTemplates.id, id),
              isNull(emailTemplates.archivedAt),
            ),
          ),
      );
    }
    if (type === "segment") {
      return exists(
        this.database.orm
          .select({ id: segments.id })
          .from(segments)
          .where(and(this.inWorkspace(segments), eq(segments.id, id))),
      );
    }
    if (type === "form") {
      return exists(
        this.database.orm
          .select({ id: forms.id })
          .from(forms)
          .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived"))),
      );
    }
    return exists(
      this.database.orm
        .select({ id: landingPages.id })
        .from(landingPages)
        .where(
          and(
            this.inWorkspace(landingPages),
            eq(landingPages.id, id),
            ne(landingPages.status, "archived"),
          ),
        ),
    );
  }

  private async linkExists(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
  }): Promise<boolean> {
    return Boolean(
      await this.database.orm
        .select({ id: projectItems.resourceId })
        .from(projectItems)
        .where(
          and(
            this.inWorkspace(projectItems),
            eq(projectItems.projectId, input.projectId),
            eq(projectItems.resourceType, input.resourceType),
            eq(projectItems.resourceId, input.resourceId),
          ),
        )
        .get(),
    );
  }

  private async readAvailable(type: ProjectResourceType, id: string): Promise<unknown> {
    if (type === "automation") {
      return this.database.orm
        .select({ id: automations.id })
        .from(automations)
        .where(
          and(
            this.inWorkspace(automations),
            eq(automations.id, id),
            ne(automations.status, "archived"),
          ),
        )
        .get();
    }
    if (type === "email") {
      return this.database.orm
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(
          and(
            this.inWorkspace(emailTemplates),
            eq(emailTemplates.id, id),
            isNull(emailTemplates.archivedAt),
          ),
        )
        .get();
    }
    if (type === "segment") {
      return this.database.orm
        .select({ id: segments.id })
        .from(segments)
        .where(and(this.inWorkspace(segments), eq(segments.id, id)))
        .get();
    }
    if (type === "form") {
      return this.database.orm
        .select({ id: forms.id })
        .from(forms)
        .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")))
        .get();
    }
    return this.database.orm
      .select({ id: landingPages.id })
      .from(landingPages)
      .where(
        and(
          this.inWorkspace(landingPages),
          eq(landingPages.id, id),
          ne(landingPages.status, "archived"),
        ),
      )
      .get();
  }

  private async resolveResources(
    rows: Array<{ resourceType: string; resourceId: string }>,
  ): Promise<Map<string, ResolvedResource>> {
    const ids = (type: ProjectResourceType) =>
      rows.filter((row) => row.resourceType === type).map((row) => row.resourceId);
    const [automationRows, emailRows, segmentRows, formRows, pageRows] = await Promise.all([
      this.resolveAutomations(ids("automation")),
      this.resolveEmails(ids("email")),
      this.resolveSegments(ids("segment")),
      this.resolveForms(ids("form")),
      this.resolvePages(ids("page")),
    ]);
    return new Map(
      [...automationRows, ...emailRows, ...segmentRows, ...formRows, ...pageRows].map((item) => [
        resourceKey(item.type, item.id),
        item.resource,
      ]),
    );
  }

  private async resolveAutomations(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select({ id: automations.id, name: automations.name, status: automations.status })
      .from(automations)
      .where(and(this.inWorkspace(automations), inJsonIds(automations.id, ids)));
    return rows.map((row) => ({
      type: "automation" as const,
      id: row.id,
      resource: {
        name: row.name,
        status: row.status,
        availability: row.status === "archived" ? ("archived" as const) : ("available" as const),
      },
    }));
  }

  private async resolveEmails(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        archivedAt: emailTemplates.archivedAt,
        publishedAt: emailTemplates.publishedAt,
      })
      .from(emailTemplates)
      .where(and(this.inWorkspace(emailTemplates), inJsonIds(emailTemplates.id, ids)));
    return rows.map((row) => ({
      type: "email" as const,
      id: row.id,
      resource: {
        name: row.name,
        status: row.archivedAt ? "archived" : row.publishedAt ? "published" : "draft",
        availability: row.archivedAt ? ("archived" as const) : ("available" as const),
      },
    }));
  }

  private async resolveSegments(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select({ id: segments.id, name: segments.name, status: segments.evaluationStatus })
      .from(segments)
      .where(and(this.inWorkspace(segments), inJsonIds(segments.id, ids)));
    return rows.map((row) => ({
      type: "segment" as const,
      id: row.id,
      resource: { name: row.name, status: row.status, availability: "available" as const },
    }));
  }

  private async resolveForms(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select({ id: forms.id, name: forms.name, status: forms.status })
      .from(forms)
      .where(and(this.inWorkspace(forms), inJsonIds(forms.id, ids)));
    return rows.map((row) => ({
      type: "form" as const,
      id: row.id,
      resource: {
        name: row.name,
        status: row.status,
        availability: row.status === "archived" ? ("archived" as const) : ("available" as const),
      },
    }));
  }

  private async resolvePages(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select({ id: landingPages.id, name: landingPages.name, status: landingPages.status })
      .from(landingPages)
      .where(and(this.inWorkspace(landingPages), inJsonIds(landingPages.id, ids)));
    return rows.map((row) => ({
      type: "page" as const,
      id: row.id,
      resource: {
        name: row.name,
        status: row.status,
        availability: row.status === "archived" ? ("archived" as const) : ("available" as const),
      },
    }));
  }
}

function resourceKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** D1 caps bound parameters at 100; JSON1 keeps each resource-type lookup to one bind. */
function inJsonIds(column: SQLWrapper, ids: string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;
}
