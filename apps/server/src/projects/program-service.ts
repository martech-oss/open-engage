import {
  programMemberMutationSchema,
  type ProgramMemberMutationResult,
} from "@openengage/core/projects";
import { hasWorkspaceRole, type WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import {
  FormProgramRepository,
  ProjectMemberRepository,
  ProjectProgramRepository,
  ProgramError,
  type ProgramMemberCommand,
} from "@openengage/database/projects";

import { getProjectBrief } from "./project-brief-service";

export async function mutateProjectMember(
  database: OpenEngageDatabase,
  workspace: { workspaceId: string },
  input: ProgramMemberCommand,
): Promise<ProgramMemberMutationResult> {
  const parsed = programMemberMutationSchema.safeParse(input);
  if (!parsed.success)
    throw new ProgramError(
      "invalid",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  return new ProjectMemberRepository(database, workspace).mutate({
    ...parsed.data,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.authority ? { authority: input.authority } : {}),
  });
}
export async function getProgramDetail(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  projectId: string,
) {
  const repository = new ProjectProgramRepository(database, workspace);
  const project = await repository.project(projectId);
  const brief = await repository.brief(projectId);
  const canManageMembers = hasWorkspaceRole(workspace.role, "marketer");
  const canOwn =
    canManageMembers &&
    (!brief || brief.ownerUserId === workspace.userId || hasWorkspaceRole(workspace.role, "admin"));
  return {
    project,
    program: await repository.get(projectId),
    brief: brief ? await getProjectBrief(database, workspace, projectId) : null,
    allowedActions: {
      manageMembers: canManageMembers,
      editDefinition: canOwn && (!brief || brief.status === "draft"),
      publishDefinition: canOwn && (!brief || brief.status === "approved"),
    },
    formBindings: await new FormProgramRepository(database, workspace).list(projectId),
  };
}
export { importProgramMembers } from "./program-import-service";
