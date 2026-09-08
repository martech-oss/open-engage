import { hasWorkspaceRole } from "@openengage/core/shared";
import { writeAuditLog } from "@openengage/database/platform";
import {
  ProjectRepository,
  FormProgramRepository,
  ProjectMemberRepository,
  ProjectProgramRepository,
  ProgramError,
} from "@openengage/database/projects";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { getProgramDetail, importProgramMembers, mutateProjectMember } from "./program-service";

interface ProgramErrors {
  PROGRAM_NOT_FOUND: () => Error;
  PROGRAM_CONFLICT: (options?: { message: string }) => Error;
  PROGRAM_INVALID: (options?: { message: string }) => Error;
  FORBIDDEN: () => Error;
}
async function execute<T>(errors: ProgramErrors, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    switch (error.code) {
      case "not_found":
        throw errors.PROGRAM_NOT_FOUND();
      case "conflict":
        throw errors.PROGRAM_CONFLICT({ message: error.message });
      case "invalid":
        throw errors.PROGRAM_INVALID({ message: error.message });
      case "forbidden":
        throw errors.FORBIDDEN();
    }
  }
}
export const programProcedures = {
  programCatalog: authed.projects.programCatalog.handler(async ({ context }) => ({
    projects: await new ProjectRepository(context.database, context.workspace).list(),
    allowedActions: { create: hasWorkspaceRole(context.workspace.role, "marketer") },
  })),
  programGet: authed.projects.programGet.handler(({ context, input, errors }) =>
    execute(errors, () => getProgramDetail(context.database, context.workspace, input.id)),
  ),
  programSave: authed.projects.programSave.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const result = await new ProjectProgramRepository(context.database, context.workspace).save(
        context.workspace,
        input.id,
        input,
      );
      await writeAuditLog(context.database, context.workspace, {
        action: "project.program.save",
        resourceType: "project",
        resourceId: input.id,
        metadata: { rowVersion: result.rowVersion },
      });
      return result;
    }),
  ),
  programPublish: authed.projects.programPublish.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const result = await new ProjectProgramRepository(
        context.database,
        context.workspace,
      ).publish(context.workspace, input.id, input.expectedRowVersion);
      await writeAuditLog(context.database, context.workspace, {
        action: "project.program.publish",
        resourceType: "project",
        resourceId: input.id,
        metadata: { version: result.publishedVersion },
      });
      return result;
    }),
  ),
  memberList: authed.projects.memberList.handler(({ context, input, errors }) =>
    execute(errors, () =>
      new ProjectMemberRepository(context.database, context.workspace).list(input.id, input),
    ),
  ),
  memberMutate: authed.projects.memberMutate.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const { id, ...mutation } = input;
      return mutateProjectMember(context.database, context.workspace, {
        ...mutation,
        projectId: id,
        actorUserId: context.workspace.userId,
      });
    }),
  ),
  memberImport: authed.projects.memberImport.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      return importProgramMembers(context.database, context.workspace, {
        ...input,
        projectId: input.id,
      });
    }),
  ),
  memberHistory: authed.projects.memberHistory.handler(({ context, input, errors }) =>
    execute(errors, () =>
      new ProjectMemberRepository(context.database, context.workspace).history(
        input.id,
        input.contactId,
      ),
    ),
  ),
  programCohort: authed.projects.programCohort.handler(({ context, input, errors }) =>
    execute(errors, () =>
      new ProjectMemberRepository(context.database, context.workspace).cohort(input.id, input),
    ),
  ),
  programBindForm: authed.projects.programBindForm.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const detail = await getProgramDetail(context.database, context.workspace, input.id);
      if (!detail.allowedActions.publishDefinition)
        throw new ProgramError(
          "forbidden",
          "Approval is required before changing a published form binding",
        );
      if (input.binding && input.binding.projectId !== input.id)
        throw new ProgramError("invalid", "Form binding must use this explicit Project");
      const repository = new FormProgramRepository(context.database, context.workspace);
      const previous = await repository.get(input.formId);
      if (previous && previous.projectId !== input.id)
        throw new ProgramError(
          "conflict",
          "Unbind this shared form from its existing Project first",
        );
      await repository.set(input.formId, input.binding);
      await writeAuditLog(context.database, context.workspace, {
        action: "project.program.bind_form",
        resourceType: "project",
        resourceId: input.id,
        metadata: { formId: input.formId, binding: input.binding },
      });
      return ack;
    }),
  ),
};
