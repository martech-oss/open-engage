import type {
  ProjectBriefDetail,
  ProjectBriefMutation,
  ProjectBriefSummary,
  ProjectMemberOption,
  ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  ProjectBriefRepository,
  type OpenEngageDatabase,
  writeAuditLog,
} from "@openengage/database";

export type ProjectBriefServiceFailure =
  | "not_found"
  | "invalid_state"
  | "revision_conflict"
  | "invalid_member"
  | "forbidden_actor"
  | "resource_not_found";

export class ProjectBriefServiceError extends Error {
  public constructor(public readonly kind: ProjectBriefServiceFailure) {
    super(`Project brief operation ${kind}`);
    this.name = "ProjectBriefServiceError";
  }
}

export async function listProjectBriefs(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<ProjectBriefSummary[]> {
  return new ProjectBriefRepository(database, workspace).listBriefs();
}

export async function getProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<ProjectBriefDetail> {
  const detail = await new ProjectBriefRepository(database, workspace).getBrief(id);
  if (!detail) fail("not_found");
  return detail;
}

export async function projectBriefMembers(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<ProjectMemberOption[]> {
  return new ProjectBriefRepository(database, workspace).eligibleMembers();
}

export async function approvedProjectBriefContext(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: { projectId?: string | undefined; briefRevision?: number | undefined },
): Promise<
  | {
      projectId: string;
      revision: number;
      name: string;
      primaryMotion: ProjectBriefDetail["project"]["primaryMotion"];
      definition: ProjectBriefDetail["definition"];
    }
  | undefined
> {
  const { projectId, briefRevision } = reference;
  if (projectId === undefined && briefRevision === undefined) return undefined;
  if (!projectId || briefRevision === undefined) fail("revision_conflict");
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, projectId);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (record.status !== "approved") fail("invalid_state");
  if (record.revision !== briefRevision) fail("revision_conflict");
  const detail = await repository.getBrief(projectId);
  if (!detail) fail("not_found");
  return {
    projectId,
    revision: record.revision,
    name: detail.project.name,
    primaryMotion: record.primaryMotion,
    definition: detail.definition,
  };
}

export async function createProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ProjectBriefMutation,
): Promise<{ id: string }> {
  const repository = new ProjectBriefRepository(database, workspace);
  await validateMembers(repository, input);
  const result = await repository.createBrief(input);
  await audit(database, workspace, "project.brief.create", result.id);
  return result;
}

export async function updateProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ProjectBriefMutation,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, id);
  if (record.ownerUserId !== workspace.userId) fail("forbidden_actor");
  await validateMembers(repository, input);
  const outcome = await repository.updateBrief(id, input);
  if (outcome.kind === "not_found") fail("not_found");
  if (outcome.kind === "invalid_status") fail("invalid_state");
  if (outcome.kind !== "done") fail("invalid_member");
  await audit(database, workspace, "project.brief.update", id);
}

export async function submitProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, id);
  if (record.ownerUserId !== workspace.userId) fail("forbidden_actor");
  if (record.status !== "draft" || !(await repository.setPending(id))) fail("invalid_state");
  await audit(database, workspace, "project.brief.submit", id, { revision: record.revision });
}

export async function reviewProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  decision: "approved" | "rejected",
  comment: string,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, id);
  if (record.approverUserId !== workspace.userId) fail("forbidden_actor");
  if (
    record.status !== "pending_approval" ||
    !(await repository.review(id, { decision, comment }))
  ) {
    fail("invalid_state");
  }
  await audit(database, workspace, `project.brief.${decision}`, id, {
    revision: record.revision,
    comment,
  });
}

export async function reopenProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (!(await repository.reopen(id))) fail("invalid_state");
  await audit(database, workspace, "project.brief.reopen", id, {
    previousRevision: record.revision,
    revision: record.revision + 1,
  });
}

export async function completeProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (!(await repository.complete(id))) fail("invalid_state");
  await audit(database, workspace, "project.brief.complete", id, { revision: record.revision });
}

export async function archiveProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  await requireRecord(repository, id);
  if (!isAdmin(workspace)) fail("forbidden_actor");
  if (!(await repository.archive(id))) fail("not_found");
  await audit(database, workspace, "project.brief.archive", id);
}

export async function addProjectBriefItem(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { id: string; resourceType: ProjectResourceType; resourceId: string },
): Promise<{ added: boolean }> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, input.id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  const outcome = await repository.addApprovedItem({
    projectId: input.id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
  if (outcome.kind === "brief_not_approved") fail("invalid_state");
  if (outcome.kind === "resource_not_found") fail("resource_not_found");
  if (outcome.kind === "project_not_found") fail("not_found");
  if (outcome.added) {
    await audit(database, workspace, "project.item.add", input.id, {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      briefRevision: record.revision,
    });
  }
  return { added: outcome.added };
}

export async function removeProjectBriefItem(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { id: string; resourceType: ProjectResourceType; resourceId: string },
): Promise<void> {
  const repository = new ProjectBriefRepository(database, workspace);
  const record = await requireRecord(repository, input.id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  await repository.removeItem({
    projectId: input.id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
  await audit(database, workspace, "project.item.remove", input.id, {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
}

async function validateMembers(
  repository: ProjectBriefRepository,
  input: Pick<ProjectBriefMutation, "ownerUserId" | "approverUserId">,
): Promise<void> {
  if (input.ownerUserId === input.approverUserId) fail("invalid_member");
  const memberIds = new Set((await repository.eligibleMembers()).map((member) => member.id));
  if (!memberIds.has(input.ownerUserId) || !memberIds.has(input.approverUserId)) {
    fail("invalid_member");
  }
}

async function requireRecord(repository: ProjectBriefRepository, id: string) {
  const record = await repository.findRecord(id);
  if (!record) fail("not_found");
  return record;
}

function requireOwnerOrAdmin(workspace: WorkspaceContext, ownerUserId: string): void {
  if (workspace.userId !== ownerUserId && !isAdmin(workspace)) fail("forbidden_actor");
}

function isAdmin(workspace: WorkspaceContext): boolean {
  return workspace.role === "admin" || workspace.role === "owner";
}

async function audit(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(database, workspace, {
    action,
    resourceType: "project",
    resourceId,
    ...(metadata ? { metadata } : {}),
  });
}

function fail(kind: ProjectBriefServiceFailure): never {
  throw new ProjectBriefServiceError(kind);
}
