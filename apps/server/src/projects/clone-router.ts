import { ProjectCloneError, ProjectCloneQueryRepository } from "@openengage/database/projects";

import { authed, requireRole } from "../orpc/base";
import {
  getProjectClone,
  getProjectCloneProgress,
  previewProjectClone,
  retryProjectClone,
  startProjectClone,
} from "./clone-service";

function rethrow(
  error: unknown,
  errors: {
    PROJECT_CLONE_NOT_FOUND: (options?: { message?: string }) => Error;
    PROJECT_CLONE_INVALID: (options?: { message?: string }) => Error;
    PROJECT_CLONE_CONFLICT: (options?: { message?: string }) => Error;
  },
): never {
  if (!(error instanceof ProjectCloneError)) throw error;
  if (error.kind === "not_found") throw errors.PROJECT_CLONE_NOT_FOUND({ message: error.message });
  if (error.kind === "conflict") throw errors.PROJECT_CLONE_CONFLICT({ message: error.message });
  throw errors.PROJECT_CLONE_INVALID({ message: error.message });
}
export const projectCloneProcedures = {
  clonePreview: authed.projects.clonePreview.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await previewProjectClone(
        context.database,
        context.workspace,
        input.id,
        input.options,
        context.env.APP_URL,
      );
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  cloneList: authed.projects.cloneList.handler(({ context, input }) =>
    new ProjectCloneQueryRepository(context.database, context.workspace).list(input.id, input),
  ),
  cloneProgress: authed.projects.cloneProgress.handler(async ({ context, input, errors }) => {
    try {
      return await getProjectCloneProgress(
        context.database,
        context.workspace.workspaceId,
        input.id,
        input.jobId,
      );
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  cloneGet: authed.projects.cloneGet.handler(async ({ context, input, errors }) => {
    try {
      return await getProjectClone(
        context.database,
        context.workspace.workspaceId,
        input.id,
        input.jobId,
      );
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  cloneStart: authed.projects.cloneStart.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await startProjectClone(context.database, context.workspace, context.env.JOBS_QUEUE, {
        projectId: input.id,
        jobId: input.jobId,
        requestKey: input.requestKey,
      });
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  cloneRetry: authed.projects.cloneRetry.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await retryProjectClone(context.database, context.workspace, context.env.JOBS_QUEUE, {
        projectId: input.id,
        jobId: input.jobId,
      });
    } catch (error) {
      rethrow(error, errors);
    }
  }),
};
