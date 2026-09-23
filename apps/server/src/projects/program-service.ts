import {
  programMemberMutationSchema,
  type ProgramMemberMutationResult,
  type ProgramBinding,
  type ProjectProgramDefinition,
} from "@openengage/core/projects";
import { hasWorkspaceRole, type WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { writeAuditLog } from "@openengage/database/platform";
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
  const canOwn = canManageMembers && canOwnProgram(workspace, brief);
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

/** The brief owner, or an admin, owns a program's definition; one without a brief is open. */
function canOwnProgram(
  workspace: WorkspaceContext,
  brief: { ownerUserId: string } | null | undefined,
): boolean {
  return (
    !brief || brief.ownerUserId === workspace.userId || hasWorkspaceRole(workspace.role, "admin")
  );
}

export async function saveProgram(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  projectId: string,
  input: { definition: ProjectProgramDefinition; expectedRowVersion: number },
) {
  const result = await new ProjectProgramRepository(database, workspace).save(
    workspace,
    projectId,
    input,
  );
  await writeAuditLog(database, workspace, {
    action: "project.program.save",
    resourceType: "project",
    resourceId: projectId,
    metadata: { rowVersion: result.rowVersion },
  });
  return result;
}

export async function publishProgram(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  projectId: string,
  expectedRowVersion: number,
) {
  const result = await new ProjectProgramRepository(database, workspace).publish(
    workspace,
    projectId,
    expectedRowVersion,
  );
  await writeAuditLog(database, workspace, {
    action: "project.program.publish",
    resourceType: "project",
    resourceId: projectId,
    metadata: { version: result.publishedVersion },
  });
  return result;
}

/**
 * Binds a form to this program, or releases it with a null binding. Taking a
 * form from another program requires owning that program too, and only works
 * once it is archived.
 */
export async function bindProgramForm(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { projectId: string; formId: string; binding: ProgramBinding | null },
): Promise<void> {
  const programs = new ProjectProgramRepository(database, workspace);
  const requireBindingPermission = async (projectId: string, includeArchived: boolean) => {
    const project = await programs.project(projectId, { includeArchived });
    const brief = await programs.brief(projectId);
    if (
      !canOwnProgram(workspace, brief) ||
      (brief && brief.status !== "approved" && !project.archivedAt)
    )
      throw new ProgramError(
        "forbidden",
        "Approval is required before changing a published form binding",
      );
    return project;
  };
  // Archived Projects may release bindings, but cannot receive new ones.
  await requireBindingPermission(input.projectId, input.binding === null);
  if (input.binding && input.binding.projectId !== input.projectId)
    throw new ProgramError("invalid", "Form binding must use this explicit Project");
  const repository = new FormProgramRepository(database, workspace);
  const previous = await repository.getIntent(input.formId);
  if (previous && previous.projectId !== input.projectId) {
    const priorProject = await requireBindingPermission(previous.projectId, true);
    if (!priorProject.archivedAt)
      throw new ProgramError("conflict", "Unbind this shared form from its existing Project first");
  }
  await repository.set(input.formId, input.binding);
  await writeAuditLog(database, workspace, {
    action: "project.program.bind_form",
    resourceType: "project",
    resourceId: input.projectId,
    metadata: { formId: input.formId, binding: input.binding },
  });
}

export { importProgramMembers } from "./program-import-service";
