import type { ProjectResourceType, ProjectRow } from "@openengage/core/projects";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ProjectRepository, type ProjectItemOutcome } from "@openengage/database/projects";

export async function listProjects(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<ProjectRow[]> {
  return new ProjectRepository(database, { workspaceId }).list();
}

export async function createProject(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: { name: string; description: string; color: string },
): Promise<{ id: string }> {
  return new ProjectRepository(database, { workspaceId }).create(input);
}

export type { ProjectItemOutcome } from "@openengage/database/projects";

export async function addProjectItem(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: { projectId: string; resourceType: ProjectResourceType; resourceId: string },
): Promise<ProjectItemOutcome> {
  return new ProjectRepository(database, { workspaceId }).addItem(input);
}
export { mutateProjectMember } from "./program-service";
