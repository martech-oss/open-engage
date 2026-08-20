import { and, desc, eq } from "drizzle-orm";

import {
  projectLinkedResourceSchema,
  type ProjectLinkedResource,
  type ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { WorkspaceRepository } from "../shared/repository-base";
import {
  createProjectResourceResolverRegistry,
  projectResourceKey,
  resolveProjectResources,
} from "./project-resource-resolvers";
import { projectItems } from "./schema";

export class ProjectResourceQueryRepository extends WorkspaceRepository<WorkspaceContext> {
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
    const resources = await resolveProjectResources(this.resourceResolvers(), rows);
    return rows.map((row) =>
      projectLinkedResourceSchema.parse({
        ...row,
        ...(resources.get(projectResourceKey(row.resourceType, row.resourceId)) ?? {
          name: row.resourceId,
          status: null,
          availability: "missing" as const,
        }),
        stale: row.briefRevision !== revision,
      }),
    );
  }

  public async isAvailable(type: ProjectResourceType, id: string): Promise<boolean> {
    return Boolean(await this.resourceResolvers()[type].readAvailable(id));
  }

  public async linkExists(input: {
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

  public resourceResolvers() {
    return createProjectResourceResolverRegistry(this.database, this.context.workspaceId);
  }
}
