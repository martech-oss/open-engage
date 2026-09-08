import { signupFormDefinitionSchema, type FormHandlerWrite } from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { isConstraintError } from "@openengage/database/shared";
import { FormHandlerRepository, PublicFormHandlerRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { isValidDomain, normalizeDomain } from "./domain";

async function validate(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: FormHandlerWrite,
) {
  input.allowedDomains = input.allowedDomains.map(normalizeDomain);
  if (input.allowedDomains.some((domain) => !isValidDomain(domain))) return false;
  const parsed = signupFormDefinitionSchema.safeParse(
    await new PublicFormHandlerRepository(database).formFields(workspaceId, input.formId),
  );
  if (!parsed.success) return false;
  const fields = new Set(["email", ...(parsed.data.fields ?? []).map((field) => field.key)]);
  const targets = Object.values(input.fieldMapping);
  return (
    targets.includes("email") &&
    new Set(targets).size === targets.length &&
    targets.every((target) => fields.has(target))
  );
}
export const formHandlerProcedures = {
  listFormHandlers: authed.website.listFormHandlers.handler(({ context }) =>
    new FormHandlerRepository(context.database, context.workspace).list(),
  ),
  createFormHandler: authed.website.createFormHandler.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      if (!(await validate(context.database, context.workspace.workspaceId, input)))
        throw errors.HANDLER_INVALID();
      try {
        return await new FormHandlerRepository(context.database, context.workspace).create(input);
      } catch (error) {
        if (isConstraintError(error)) throw errors.HANDLER_SLUG_TAKEN();
        throw error;
      }
    },
  ),
  updateFormHandler: authed.website.updateFormHandler.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      if (!(await validate(context.database, context.workspace.workspaceId, input)))
        throw errors.HANDLER_INVALID();
      try {
        if (
          !(await new FormHandlerRepository(context.database, context.workspace).update(
            input.id,
            input,
          ))
        )
          throw errors.HANDLER_NOT_FOUND();
      } catch (error) {
        if (isConstraintError(error)) throw errors.HANDLER_SLUG_TAKEN();
        throw error;
      }
      return ack;
    },
  ),
  deleteFormHandler: authed.website.deleteFormHandler.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      if (!(await new FormHandlerRepository(context.database, context.workspace).delete(input.id)))
        throw errors.HANDLER_NOT_FOUND();
      return ack;
    },
  ),
};
