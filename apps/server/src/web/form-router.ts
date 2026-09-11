import { SignupFormRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { FormCommandService } from "./form-command-service";

export const listFormsProcedure = authed.website.listForms.handler(({ context }) =>
  new SignupFormRepository(context.database, context.workspace).listSignupForms(),
);

export const createFormProcedure = authed.website.createForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await new FormCommandService(
      context.database,
      context.workspace,
      context.env,
    ).create(input);
    switch (outcome.kind) {
      case "ok":
        return { id: outcome.id };
      case "turnstile_not_configured":
        throw errors.TURNSTILE_NOT_CONFIGURED();
      case "variable_invalid":
        throw errors.FORM_VARIABLE_INVALID({ cause: outcome.cause });
      case "slug_taken":
        throw errors.FORM_SLUG_TAKEN({ cause: outcome.cause });
    }
  },
);

export const updateFormProcedure = authed.website.updateForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await new FormCommandService(
      context.database,
      context.workspace,
      context.env,
    ).update(input);
    switch (outcome.kind) {
      case "ok":
        return { id: outcome.id };
      case "not_found":
        throw errors.FORM_NOT_FOUND();
      case "turnstile_not_configured":
        throw errors.TURNSTILE_NOT_CONFIGURED();
      case "variable_invalid":
        throw errors.FORM_VARIABLE_INVALID({ cause: outcome.cause });
      case "slug_taken":
        throw errors.FORM_SLUG_TAKEN({ cause: outcome.cause });
    }
  },
);

export const archiveFormProcedure = authed.website.archiveForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new SignupFormRepository(context.database, context.workspace);
    if (!(await repository.archiveSignupForm(input.id))) throw errors.FORM_NOT_FOUND();
    return ack;
  },
);

export const formProcedures = {
  listForms: listFormsProcedure,
  createForm: createFormProcedure,
  updateForm: updateFormProcedure,
  archiveForm: archiveFormProcedure,
};
