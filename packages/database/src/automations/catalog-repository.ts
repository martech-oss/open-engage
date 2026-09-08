import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { projectProgramDefinitionSchema } from "@openengage/core/projects";

import { projectPrograms, projectProgramVersions } from "../projects/program-schema";
import { projects } from "../projects/schema";
import { scoringCategories } from "../scoring/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { automations, automationVersions } from "./schema";
export class AutomationCatalogRepository extends WorkspaceRepository {
  public async executionOptions() {
    const [projectRows, callableAutomations, categories] = await Promise.all([
      this.database.orm
        .select({
          id: projects.id,
          name: projects.name,
          definition: projectProgramVersions.definition,
        })
        .from(projects)
        .leftJoin(
          projectPrograms,
          and(
            eq(projectPrograms.projectId, projects.id),
            eq(projectPrograms.workspaceId, projects.workspaceId),
          ),
        )
        .leftJoin(
          projectProgramVersions,
          and(
            eq(projectProgramVersions.projectId, projects.id),
            eq(projectProgramVersions.workspaceId, projects.workspaceId),
            eq(projectProgramVersions.version, projectPrograms.publishedVersion),
          ),
        )
        .where(and(this.inWorkspace(projects), isNull(projects.archivedAt)))
        .limit(1000),
      this.database.orm
        .select({ id: automations.id, name: automations.name })
        .from(automations)
        .innerJoin(
          automationVersions,
          and(
            eq(automationVersions.id, automations.publishedVersionId),
            eq(automationVersions.workspaceId, automations.workspaceId),
          ),
        )
        .where(
          and(
            this.inWorkspace(automations),
            ne(automations.status, "archived"),
            sql`EXISTS(SELECT 1 FROM json_each(${automationVersions.graph},'$.nodes') n WHERE json_extract(n.value,'$.config.source')='callable')`,
          ),
        )
        .limit(1000),
      this.database.orm
        .select({ id: scoringCategories.id, name: scoringCategories.name })
        .from(scoringCategories)
        .where(and(this.inWorkspace(scoringCategories), isNull(scoringCategories.archivedAt)))
        .limit(1000),
    ]);
    return {
      projects: projectRows.map((row) => ({
        id: row.id,
        name: row.name,
        statuses: row.definition
          ? projectProgramDefinitionSchema
              .parse(JSON.parse(row.definition))
              .statuses.map((status) => ({ id: status.id, name: status.label }))
          : [],
      })),
      callableAutomations,
      scoringCategories: categories,
    };
  }
}
