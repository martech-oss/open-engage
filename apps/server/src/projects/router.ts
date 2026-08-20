import { writeAuditLog } from "@openengage/database/platform";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import {
  generateMarketingBrief,
  MarketingBriefGenerationError,
} from "./project-brief-generation-service";
import {
  addProjectBriefItem,
  archiveProjectBrief,
  completeProjectBrief,
  createProjectBrief,
  getProjectBrief,
  listProjectBriefs,
  projectBriefMembers,
  ProjectBriefServiceError,
  removeProjectBriefItem,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
  updateProjectBrief,
  withdrawProjectBrief,
} from "./project-brief-service";
import { addProjectItem, createProject, listProjects } from "./service";

export const listProjectsProcedure = authed.projects.list.handler(({ context }) =>
  listProjects(context.database, context.workspace.workspaceId),
);

export const createProjectProcedure = authed.projects.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return createProject(context.database, context.workspace.workspaceId, input);
  },
);

export const addProjectItemProcedure = authed.projects.addItem.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await addProjectItem(context.database, context.workspace.workspaceId, {
      projectId: input.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });
    if (outcome.kind === "project_not_found") throw errors.PROJECT_NOT_FOUND();
    if (outcome.kind === "brief_managed") throw errors.PROJECT_BRIEF_MANAGED();
    return { added: outcome.added };
  },
);

export const listProjectBriefsProcedure = authed.projects.briefList.handler(({ context }) =>
  listProjectBriefs(context.database, context.workspace),
);

export const projectBriefOptionsProcedure = authed.projects.briefOptions.handler(
  async ({ context }) => ({
    members: await projectBriefMembers(context.database, context.workspace),
  }),
);

export const getProjectBriefProcedure = authed.projects.briefGet.handler(
  async ({ context, input, errors }) => {
    try {
      return await getProjectBrief(context.database, context.workspace, input.id);
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const createProjectBriefProcedure = authed.projects.briefCreate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createProjectBrief(context.database, context.workspace, input);
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const updateProjectBriefProcedure = authed.projects.briefUpdate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, expectedRowVersion, ...brief } = input;
    try {
      await updateProjectBrief(context.database, context.workspace, id, {
        ...brief,
        ...(expectedRowVersion === undefined ? {} : { expectedRowVersion }),
      });
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const generateProjectBriefProcedure = authed.projects.briefGenerate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const result = await generateMarketingBrief(
        context.database,
        context.workspace,
        context.env,
        input,
      );
      await writeAuditLog(context.database, context.workspace, {
        action: "project.brief.generate",
        resourceType: "project",
        metadata: { mode: input.mode },
      });
      return result;
    } catch (error) {
      if (!(error instanceof MarketingBriefGenerationError)) throw error;
      if (error.kind === "failed") throw errors.AI_GENERATION_FAILED();
      if (error.kind === "timeout") throw errors.AI_GENERATION_TIMEOUT();
      throw errors.AI_GENERATION_UNAVAILABLE();
    }
  },
);

export const submitProjectBriefProcedure = authed.projects.briefSubmit.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await submitProjectBrief(context.database, context.workspace, input.id, input);
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const approveProjectBriefProcedure = authed.projects.briefApprove.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await reviewProjectBrief(
        context.database,
        context.workspace,
        input.id,
        "approved",
        input.comment,
        input,
      );
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const rejectProjectBriefProcedure = authed.projects.briefReject.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await reviewProjectBrief(
        context.database,
        context.workspace,
        input.id,
        "rejected",
        input.comment,
        input,
      );
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const withdrawProjectBriefProcedure = authed.projects.briefWithdraw.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await withdrawProjectBrief(
        context.database,
        context.workspace,
        input.id,
        input.reason,
        input,
      );
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const reopenProjectBriefProcedure = authed.projects.briefReopen.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await reopenProjectBrief(context.database, context.workspace, input.id, input);
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const completeProjectBriefProcedure = authed.projects.briefComplete.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await completeProjectBrief(context.database, context.workspace, input.id, input);
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const archiveProjectBriefProcedure = authed.projects.briefArchive.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    try {
      await archiveProjectBrief(context.database, context.workspace, input.id, input);
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const addProjectBriefItemProcedure = authed.projects.briefAddItem.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await addProjectBriefItem(context.database, context.workspace, input);
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const removeProjectBriefItemProcedure = authed.projects.briefRemoveItem.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await removeProjectBriefItem(context.database, context.workspace, input);
      return ack;
    } catch (error) {
      rethrowBrief(error, errors);
    }
  },
);

export const projectProcedures = {
  list: listProjectsProcedure,
  create: createProjectProcedure,
  addItem: addProjectItemProcedure,
  briefList: listProjectBriefsProcedure,
  briefOptions: projectBriefOptionsProcedure,
  briefGet: getProjectBriefProcedure,
  briefCreate: createProjectBriefProcedure,
  briefUpdate: updateProjectBriefProcedure,
  briefGenerate: generateProjectBriefProcedure,
  briefSubmit: submitProjectBriefProcedure,
  briefApprove: approveProjectBriefProcedure,
  briefReject: rejectProjectBriefProcedure,
  briefWithdraw: withdrawProjectBriefProcedure,
  briefReopen: reopenProjectBriefProcedure,
  briefComplete: completeProjectBriefProcedure,
  briefArchive: archiveProjectBriefProcedure,
  briefAddItem: addProjectBriefItemProcedure,
  briefRemoveItem: removeProjectBriefItemProcedure,
};

interface BriefErrors {
  FORBIDDEN?: () => Error;
  PROJECT_BRIEF_NOT_FOUND?: () => Error;
  INVALID_BRIEF_STATE?: () => Error;
  BRIEF_WRITE_CONFLICT?: () => Error;
  INVALID_BRIEF_MEMBER?: () => Error;
  PROJECT_RESOURCE_NOT_FOUND?: () => Error;
}

function rethrowBrief(error: unknown, errors: BriefErrors): never {
  if (!(error instanceof ProjectBriefServiceError)) throw error;
  const kind = error.kind;
  switch (kind) {
    case "not_found":
      if (errors.PROJECT_BRIEF_NOT_FOUND) throw errors.PROJECT_BRIEF_NOT_FOUND();
      break;
    case "invalid_state":
    case "revision_conflict":
      if (errors.INVALID_BRIEF_STATE) throw errors.INVALID_BRIEF_STATE();
      break;
    case "write_conflict":
      if (errors.BRIEF_WRITE_CONFLICT) throw errors.BRIEF_WRITE_CONFLICT();
      break;
    case "invalid_member":
      if (errors.INVALID_BRIEF_MEMBER) throw errors.INVALID_BRIEF_MEMBER();
      break;
    case "resource_not_found":
      if (errors.PROJECT_RESOURCE_NOT_FOUND) throw errors.PROJECT_RESOURCE_NOT_FOUND();
      break;
    case "forbidden_actor":
      if (errors.FORBIDDEN) throw errors.FORBIDDEN();
      break;
    default:
      assertNever(kind);
  }
  throw error;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled project brief failure: ${String(value)}`);
}
