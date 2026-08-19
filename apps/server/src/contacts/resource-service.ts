import type {
  Contact,
  ContactBulkAction,
  ContactOptions,
  ContactProfile,
  ContactScoreAdjust,
  TagCreate,
  TagUpdate,
} from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ContactRepository, ContactResourceRepository } from "@openengage/database/contacts";
import { isConstraintError, uuidv7 } from "@openengage/database/shared";

import { recordContactEvent } from "../contacts/event-service";
import { resourceSlug } from "../platform/values";
import { updateSegmentMemberCount } from "../segments/membership-service";

/** A resource name already taken within the workspace. */
export class ResourceConflictError extends Error {
  public constructor(public readonly resource: "tag") {
    super(`${resource} already exists`);
    this.name = "ResourceConflictError";
  }
}

export async function getContactOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<ContactOptions> {
  const rows = await new ContactResourceRepository(database, workspace).getContactOptionRows();
  return {
    tags: rows.tags,
    segments: rows.segments.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      kind: row.kind === "dynamic" ? "dynamic" : "static",
      filterAst: row.filterAst,
      membershipSource: row.membershipSource,
      filterVersion: row.filterVersion,
      memberCount: row.memberCount,
      evaluatedAt: row.evaluatedAt,
      evaluationStatus:
        row.evaluationStatus === "pending" ||
        row.evaluationStatus === "running" ||
        row.evaluationStatus === "failed"
          ? row.evaluationStatus
          : "ready",
      evaluationError: row.evaluationError,
    })),
    companies: rows.accounts,
    stages: rows.stages,
  };
}

export async function getContactProfile(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  contactId: string,
): Promise<ContactProfile | null> {
  const contact = await new ContactRepository(database, workspace).getContact(contactId);
  if (!contact) return null;
  const rows = await new ContactResourceRepository(database, workspace).getContactProfileRows(
    contactId,
  );
  return {
    contact,
    tags: rows.tags,
    segments: rows.segments.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind === "dynamic" ? "dynamic" : "static",
      source: row.source,
      joinedAt: row.joinedAt,
    })),
    companies: rows.accounts.map((row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      title: row.title,
      isPrimary: row.isPrimary,
    })),
    scoreEvents: rows.scoreEvents,
    timeline: rows.timeline,
  };
}

export async function createTag(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: TagCreate,
): Promise<{ id: string; name: string; slug: string; color: string }> {
  const id = uuidv7();
  const slug = resourceSlug(input.name, id);
  try {
    await new ContactResourceRepository(database, workspace).createTag({
      id,
      slug,
      name: input.name,
      color: input.color,
    });
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new ResourceConflictError("tag");
  }
  return { id, slug, name: input.name, color: input.color };
}

export async function updateTag(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: TagUpdate,
): Promise<{ id: string; name: string; slug: string; color: string } | null> {
  const slug = resourceSlug(input.name, input.id);
  try {
    return await new ContactResourceRepository(database, workspace).updateTag({
      id: input.id,
      slug,
      name: input.name,
      color: input.color,
    });
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new ResourceConflictError("tag");
  }
}

export function addContactTag(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).addContactTag(
    input.contactId,
    input.resourceId,
  );
}

export function removeContactTag(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).removeContactTag(
    input.contactId,
    input.resourceId,
  );
}

export async function addContactSegment(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
  queue?: Queue,
): Promise<boolean> {
  const workspaceId = workspace.workspaceId;
  const added = await new ContactResourceRepository(database, workspace).addContactSegment(
    input.contactId,
    input.resourceId,
  );
  if (!added) return false;
  await updateSegmentMemberCount(database, workspaceId, input.resourceId);
  await recordContactEvent(database, {
    workspaceId,
    contactId: input.contactId,
    type: "segment_joined",
    resourceType: "segment",
    resourceId: input.resourceId,
    ...(queue ? { queue } : {}),
  });
  return true;
}

export async function removeContactSegment(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<void> {
  const removed = await new ContactResourceRepository(database, workspace).removeContactSegment(
    input.contactId,
    input.resourceId,
  );
  if (removed) {
    await updateSegmentMemberCount(database, workspace.workspaceId, input.resourceId);
  }
}

export async function adjustContactScore(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  contactId: string,
  input: ContactScoreAdjust,
): Promise<Contact | null> {
  const adjusted = await new ContactResourceRepository(database, workspace).adjustContactScore(
    contactId,
    input,
  );
  if (!adjusted) return null;
  return new ContactRepository(database, workspace).getContact(contactId);
}

export function restoreContact(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  contactId: string,
): Promise<boolean> {
  return new ContactRepository(database, workspace).restoreContact(contactId);
}

export type BulkActionOutcome =
  | { kind: "archive_forbidden" }
  | { kind: "resource_required" }
  | { kind: "ok"; updated: number };

/**
 * Applies one action to up to 100 contacts in a single statement. Archive and
 * restore need admin, because they are destructive across many records at once.
 */
export async function applyContactBulkAction(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ContactBulkAction,
): Promise<BulkActionOutcome> {
  const repository = new ContactResourceRepository(database, workspace);
  if (input.action === "archive" || input.action === "restore") {
    if (!["admin", "owner"].includes(workspace.role)) return { kind: "archive_forbidden" };
    const contactIds = [...new Set(input.contactIds)];
    const updated = await repository.bulkSetContactsArchived(
      contactIds,
      input.action === "archive",
    );
    return { kind: "ok", updated };
  }
  const resourceId = input.resourceId;
  if (!resourceId) return { kind: "resource_required" };
  const contactIds = [...new Set(input.contactIds)];
  let updated: number;
  if (input.action === "add_tag") {
    updated = await repository.bulkAddContactTag(contactIds, resourceId);
  } else if (input.action === "remove_tag") {
    updated = await repository.bulkRemoveContactTag(contactIds, resourceId);
  } else if (input.action === "add_segment") {
    updated = await repository.bulkAddContactSegment(contactIds, resourceId);
    if (updated > 0) await updateSegmentMemberCount(database, workspace.workspaceId, resourceId);
  } else {
    updated = await repository.bulkRemoveContactSegment(contactIds, resourceId);
    if (updated > 0) await updateSegmentMemberCount(database, workspace.workspaceId, resourceId);
  }
  return { kind: "ok", updated };
}
