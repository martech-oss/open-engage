import { and, count, desc, eq, isNull } from "drizzle-orm";

import type { ProjectResourceType, ProjectRow } from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { projectBriefs, projectItems, projects } from "./schema";

export type ProjectItemOutcome =
  | { kind: "project_not_found" }
  | { kind: "brief_managed" }
  | { kind: "done"; added: boolean };

/** Workspace-scoped project and project-item persistence. */
export class ProjectRepository extends WorkspaceRepository {
  public async list(): Promise<ProjectRow[]> {
    return await this.database.orm
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        itemCount: count(projectItems.resourceId),
      })
      .from(projects)
      .leftJoin(
        projectItems,
        and(
          eq(projectItems.workspaceId, projects.workspaceId),
          eq(projectItems.projectId, projects.id),
        ),
      )
      .where(and(this.inWorkspace(projects), isNull(projects.archivedAt)))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));
  }

  public async create(input: {
    name: string;
    description: string;
    color: string;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(projects).values({
      id,
      workspaceId: this.context.workspaceId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async addItem(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
  }): Promise<ProjectItemOutcome> {
    const project = await this.database.orm
      .select({ id: projects.id, briefProjectId: projectBriefs.projectId })
      .from(projects)
      .leftJoin(
        projectBriefs,
        and(
          eq(projectBriefs.workspaceId, projects.workspaceId),
          eq(projectBriefs.projectId, projects.id),
        ),
      )
      .where(
        and(
          this.inWorkspace(projects),
          eq(projects.id, input.projectId),
          isNull(projects.archivedAt),
        ),
      )
      .get();
    if (!project) return { kind: "project_not_found" };
    if (project.briefProjectId) return { kind: "brief_managed" };
    const result = await this.database.orm
      .insert(projectItems)
      .values({
        workspaceId: this.context.workspaceId,
        projectId: project.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        createdAt: nowIso(),
      })
      .onConflictDoNothing();
    return { kind: "done", added: result.meta.changes === 1 };
  }
}
