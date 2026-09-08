import {
  programMemberMutationSchema,
  parseProgramMemberCsv,
  type ProgramMemberMutationResult,
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
export async function importProgramMembers(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { projectId: string; csv: string; idempotencyKey: string },
) {
  const repository = new ProjectMemberRepository(database, workspace);
  await new ProjectProgramRepository(database, workspace).project(input.projectId);
  const rows: Array<{ row: number; ok: boolean; contactId?: string; error?: string }> = [];
  let parsedRows;
  try {
    parsedRows = parseProgramMemberCsv(input.csv);
  } catch (error) {
    throw new ProgramError("invalid", error instanceof Error ? error.message : "Invalid CSV");
  }
  for (const row of parsedRows) {
    if ("error" in row) {
      rows.push({ row: row.row, ok: false, error: row.error });
      continue;
    }
    const contactId = await repository.findContact(row);
    if (!contactId) {
      rows.push({
        row: row.row,
        ok: false,
        error:
          "Contact ID/email was not found or does not identify the same contact in this workspace",
      });
      continue;
    }
    try {
      await mutateProjectMember(database, workspace, {
        projectId: input.projectId,
        contactId,
        ...(row.statusId ? { statusId: row.statusId } : {}),
        source: "csv",
        idempotencyKey: `${input.idempotencyKey}:${row.row}`,
        actorUserId: workspace.userId,
      });
      rows.push({ row: row.row, ok: true, contactId });
    } catch (error) {
      if (!(error instanceof ProgramError)) throw error;
      rows.push({ row: row.row, ok: false, error: error.message });
    }
  }
  await writeAuditLog(database, workspace, {
    action: "project.members.import",
    resourceType: "project",
    resourceId: input.projectId,
    metadata: {
      succeeded: rows.filter((r) => r.ok).length,
      failed: rows.filter((r) => !r.ok).length,
    },
  });
  return { rows };
}
