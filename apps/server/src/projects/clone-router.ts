import { writeAuditLog } from "@openengage/database/platform";
import { ProjectCloneError, ProjectCloneRepository } from "@openengage/database/projects";

import { authed, requireRole } from "../orpc/base";
import { getProjectClone, previewProjectClone } from "./clone-service";

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
    new ProjectCloneRepository(context.database, context.workspace).list(input.id),
  ),
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
      await getProjectClone(context.database, context.workspace.workspaceId, input.id, input.jobId);
      const job = await new ProjectCloneRepository(context.database, context.workspace).start(
        input.jobId,
        input.requestKey,
      );
      if (job.status === "queued")
        await context.env.JOBS_QUEUE.send({
          kind: "project_clone",
          workspaceId: context.workspace.workspaceId,
          jobId: job.id,
        });
      await writeAuditLog(context.database, context.workspace, {
        action: "project.clone.start",
        resourceType: "project",
        resourceId: input.id,
        metadata: { jobId: job.id, targetProjectId: job.targetProjectId },
      });
      return job;
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  cloneRetry: authed.projects.cloneRetry.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await getProjectClone(context.database, context.workspace.workspaceId, input.id, input.jobId);
      const job = await new ProjectCloneRepository(context.database, context.workspace).retry(
        input.jobId,
      );
      if (job.status === "queued")
        await context.env.JOBS_QUEUE.send({
          kind: "project_clone",
          workspaceId: context.workspace.workspaceId,
          jobId: job.id,
        });
      return job;
    } catch (error) {
      rethrow(error, errors);
    }
  }),
};
