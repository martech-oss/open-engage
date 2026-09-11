import type {
  ApprovedMarketingBriefContext,
  ProjectBriefDetail,
  ProjectBriefDraftInput,
  ProjectBriefSummary,
  ProjectMemberOption,
  ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import {
  ProjectBriefCommandRepository,
  ProjectBriefQueryRepository,
  ProjectResourceCommandRepository,
  type ProjectBriefCommandOutcome,
} from "@openengage/database/projects";

import { loadMarketingCapabilitySnapshot } from "../agents/marketing-context";

export type ProjectBriefServiceFailure =
  | "not_found"
  | "invalid_state"
  | "write_conflict"
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

interface ExpectedRowVersion {
  expectedRowVersion?: number | undefined;
}

export async function listProjectBriefs(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<ProjectBriefSummary[]> {
  return new ProjectBriefQueryRepository(database, workspace).listBriefs();
}

export async function getProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<ProjectBriefDetail> {
  const detail = await new ProjectBriefQueryRepository(database, workspace).getBrief(
    id,
    loadMarketingCapabilitySnapshot(),
  );
  if (!detail) fail("not_found");
  return detail;
}

export async function projectBriefMembers(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<ProjectMemberOption[]> {
  return new ProjectBriefQueryRepository(database, workspace).eligibleMembers();
}

export async function approvedProjectBriefContext(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: { projectId?: string | undefined; briefRevision?: number | undefined },
): Promise<ApprovedMarketingBriefContext | undefined> {
  const { projectId, briefRevision } = reference;
  if (projectId === undefined && briefRevision === undefined) return undefined;
  if (!projectId || briefRevision === undefined) fail("revision_conflict");
  const repository = new ProjectBriefQueryRepository(database, workspace);
  const context = await repository.getApprovedContext(projectId, briefRevision);
  if (context) return context;

  const record = await repository.findRecord(projectId);
  if (!record) fail("not_found");
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (record.status !== "approved") fail("invalid_state");
  if (record.revision !== briefRevision) fail("revision_conflict");
  // An approved revision must always have an immutable snapshot. Missing data
  // is a conflict instead of silently trusting the mutable current row.
  fail("write_conflict");
}

export async function createProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ProjectBriefDraftInput,
): Promise<{ id: string }> {
  const result = await new ProjectBriefCommandRepository(database, workspace).createBrief(input);
  if (result.kind === "invalid_member") fail("invalid_member");
  if (result.kind === "forbidden_actor") fail("forbidden_actor");
  return { id: result.id };
}

export async function updateProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ProjectBriefDraftInput & ExpectedRowVersion,
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  if (record.ownerUserId !== workspace.userId) fail("forbidden_actor");
  if (record.status !== "draft") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await new ProjectBriefCommandRepository(database, workspace).updateBrief(id, {
      ...input,
      expectedRowVersion,
    }),
    expectedRowVersion,
  );
}

export async function submitProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  if (record.ownerUserId !== workspace.userId) fail("forbidden_actor");
  if (record.status !== "draft") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await new ProjectBriefCommandRepository(database, workspace).submit(id, {
      expectedRowVersion,
    }),
    expectedRowVersion,
  );
}

export async function withdrawProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  reason: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (record.status !== "pending_approval") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await new ProjectBriefCommandRepository(database, workspace).withdraw(id, {
      reason,
      expectedRowVersion,
    }),
    expectedRowVersion,
  );
}

export async function reviewProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  decision: "approved" | "rejected",
  comment: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  if (record.approverUserId !== workspace.userId) fail("forbidden_actor");
  if (record.status !== "pending_approval") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await new ProjectBriefCommandRepository(database, workspace).review(id, {
      decision,
      comment,
      expectedRowVersion,
    }),
    expectedRowVersion,
  );
}

export async function reopenProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  await ownerTransition(
    database,
    workspace,
    id,
    ["approved", "completed"],
    input,
    (command, expectedRowVersion) => command.reopen(id, { expectedRowVersion }),
  );
}

export async function completeProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  await ownerTransition(
    database,
    workspace,
    id,
    ["approved"],
    input,
    (command, expectedRowVersion) => command.complete(id, { expectedRowVersion }),
  );
}

export async function archiveProjectBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: ExpectedRowVersion = {},
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  if (!isAdmin(workspace)) fail("forbidden_actor");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await new ProjectBriefCommandRepository(database, workspace).archive(id, {
      expectedRowVersion,
    }),
    expectedRowVersion,
  );
}

export async function addProjectBriefItem(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: {
    id: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  },
): Promise<{ added: boolean }> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, input.id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (record.status !== "approved") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  const outcome = await new ProjectResourceCommandRepository(database, workspace).addApproved({
    projectId: input.id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    expectedRowVersion,
  });
  if (outcome.kind === "resource_not_found") fail("resource_not_found");
  if (outcome.kind === "conflict") fail("write_conflict");
  return { added: outcome.changed };
}

export async function removeProjectBriefItem(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: {
    id: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  },
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, input.id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (record.status !== "approved") fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  const outcome = await new ProjectResourceCommandRepository(database, workspace).removeApproved({
    projectId: input.id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    expectedRowVersion,
  });
  if (outcome.kind === "conflict") fail("write_conflict");
  if (outcome.kind === "resource_not_found") fail("resource_not_found");
}

async function ownerTransition(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  allowedStatuses: string[],
  input: ExpectedRowVersion,
  run: (
    command: ProjectBriefCommandRepository,
    expectedRowVersion: number,
  ) => Promise<ProjectBriefCommandOutcome>,
): Promise<void> {
  const query = new ProjectBriefQueryRepository(database, workspace);
  const record = await requireRecord(query, id);
  requireOwnerOrAdmin(workspace, record.ownerUserId);
  if (!allowedStatuses.includes(record.status)) fail("invalid_state");
  requireExpectedVersion(record.rowVersion, input.expectedRowVersion);
  const expectedRowVersion = input.expectedRowVersion ?? record.rowVersion;
  requireDone(
    await run(new ProjectBriefCommandRepository(database, workspace), expectedRowVersion),
    expectedRowVersion,
  );
}

async function requireRecord(repository: ProjectBriefQueryRepository, id: string) {
  const record = await repository.findRecord(id);
  if (!record) fail("not_found");
  return record;
}

function requireExpectedVersion(actual: number, expected?: number): void {
  if (expected !== undefined && actual !== expected) fail("write_conflict");
}

function requireDone(outcome: ProjectBriefCommandOutcome, expected?: number): void {
  if (outcome.kind === "done") return;
  if (outcome.kind === "invalid_member") fail("invalid_member");
  if (outcome.kind === "forbidden_actor") fail("forbidden_actor");
  fail(expected === undefined ? "invalid_state" : "write_conflict");
}

function requireOwnerOrAdmin(workspace: WorkspaceContext, ownerUserId: string): void {
  if (workspace.userId !== ownerUserId && !isAdmin(workspace)) fail("forbidden_actor");
}

function isAdmin(workspace: WorkspaceContext): boolean {
  return workspace.role === "admin" || workspace.role === "owner";
}

function fail(kind: ProjectBriefServiceFailure): never {
  throw new ProjectBriefServiceError(kind);
}
