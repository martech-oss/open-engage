import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import {
  addContactTag,
  adjustContactScore,
  applyContactBulkAction,
  createTag,
  getContactOptions,
  getContactProfile,
  removeContactSegment,
  removeContactTag,
  ResourceConflictError,
  restoreContact,
  updateTag,
} from "./resource-service";

export interface ContactResourceRouterDependencies {
  addContactSegment(input: {
    database: OpenEngageDatabase;
    workspace: WorkspaceContext;
    relation: { contactId: string; resourceId: string };
    queue: Queue;
  }): Promise<boolean>;
}

export const contactOptionsProcedure = authed.contacts.options.handler(({ context }) =>
  getContactOptions(context.database, context.workspace),
);

export const contactProfileProcedure = authed.contacts.profile.handler(
  async ({ context, input, errors }) => {
    const profile = await getContactProfile(context.database, context.workspace, input.contactId);
    if (!profile) throw errors.CONTACT_NOT_FOUND();
    return profile;
  },
);

export const createTagProcedure = authed.contacts.createTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createTag(context.database, context.workspace, input);
    } catch (error) {
      if (error instanceof ResourceConflictError) throw errors.TAG_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const updateTagProcedure = authed.contacts.updateTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const updated = await updateTag(context.database, context.workspace, input);
      if (!updated) throw errors.TAG_NOT_FOUND();
      return updated;
    } catch (error) {
      if (error instanceof ResourceConflictError) throw errors.TAG_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const addTagProcedure = authed.contacts.assignTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await addContactTag(context.database, context.workspace, input))) {
      throw errors.RELATION_REJECTED();
    }
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.contactId],
    );
    return ack;
  },
);

export const removeTagProcedure = authed.contacts.removeTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await removeContactTag(context.database, context.workspace, input))) {
      throw errors.RELATION_REJECTED();
    }
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.contactId],
    );
    return ack;
  },
);

function createAddSegmentProcedure(dependencies: ContactResourceRouterDependencies) {
  return authed.contacts.addToSegment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      !(await dependencies.addContactSegment({
        database: context.database,
        workspace: context.workspace,
        relation: input,
        queue: context.env.JOBS_QUEUE,
      }))
    ) {
      throw errors.RELATION_REJECTED();
    }
    return ack;
  });
}

// Mirrors the REST route, which reports success even when nothing matched.
export const removeSegmentProcedure = authed.contacts.removeFromSegment.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    await removeContactSegment(context.database, context.workspace, input);
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.contactId],
    );
    return ack;
  },
);

export const adjustScoreProcedure = authed.contacts.adjustScore.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { contactId, ...adjustment } = input;
    const contact = await adjustContactScore(
      context.database,
      context.workspace,
      contactId,
      adjustment,
    );
    if (!contact) throw errors.SCORE_NOT_ADJUSTABLE();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [contactId],
    );
    return contact;
  },
);

export const restoreContactProcedure = authed.contacts.restore.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await restoreContact(context.database, context.workspace, input.id))) {
      throw errors.CONTACT_NOT_ARCHIVED();
    }
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.id],
    );
    return ack;
  },
);

export const bulkActionProcedure = authed.contacts.bulkUpdate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await applyContactBulkAction(context.database, context.workspace, input);
    if (outcome.kind === "archive_forbidden") throw errors.ARCHIVE_FORBIDDEN();
    if (outcome.kind === "resource_required") throw errors.RESOURCE_REQUIRED();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      input.contactIds,
    );
    return { updated: outcome.updated };
  },
);

export function createContactResourceProcedures(dependencies: ContactResourceRouterDependencies) {
  return {
    options: contactOptionsProcedure,
    profile: contactProfileProcedure,
    createTag: createTagProcedure,
    updateTag: updateTagProcedure,
    assignTag: addTagProcedure,
    removeTag: removeTagProcedure,
    addToSegment: createAddSegmentProcedure(dependencies),
    removeFromSegment: removeSegmentProcedure,
    adjustScore: adjustScoreProcedure,
    restore: restoreContactProcedure,
    bulkUpdate: bulkActionProcedure,
  };
}
