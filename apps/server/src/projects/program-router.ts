import { hasWorkspaceRole } from "@openengage/core/shared";
import {
  ProgramMemberImportRepository,
  ProjectRepository,
  ProjectMemberRepository,
  ProgramError,
} from "@openengage/database/projects";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import {
  bindProgramForm,
  getProgramDetail,
  importProgramMembers,
  mutateProjectMember,
  publishProgram,
  saveProgram,
} from "./program-service";

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
      return saveProgram(context.database, context.workspace, input.id, input);
    }),
  ),
  programPublish: authed.projects.programPublish.handler(({ context, input, errors }) =>
    execute(errors, async () => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      return publishProgram(
        context.database,
        context.workspace,
        input.id,
        input.expectedRowVersion,
      );
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
      return importProgramMembers(context.env, context.workspace, {
        ...input,
        projectId: input.id,
      });
    }),
  ),
  memberImportGet: authed.projects.memberImportGet.handler(({ context, input, errors }) =>
    execute(errors, () =>
      new ProgramMemberImportRepository(context.database, context.workspace).detail(
        input.id,
        input.jobId,
      ),
    ),
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
      await bindProgramForm(context.database, context.workspace, {
        projectId: input.id,
        formId: input.formId,
        binding: input.binding,
      });
      return ack;
    }),
  ),
};
