import { isConstraintError } from "@openengage/database/shared";
import { CustomRedirectRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";

export const listRedirectsProcedure = authed.website.listRedirects.handler(({ context }) =>
  new CustomRedirectRepository(context.database, context.workspace).listRedirects(),
);

export const createRedirectProcedure = authed.website.createRedirect.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await new CustomRedirectRepository(context.database, context.workspace).createRedirect(
        input,
      );
    } catch (error) {
      if (isConstraintError(error)) throw errors.REDIRECT_SLUG_TAKEN();
      throw error;
    }
  },
);

export const updateRedirectProcedure = authed.website.updateRedirect.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    try {
      if (
        !(await new CustomRedirectRepository(context.database, context.workspace).updateRedirect(
          id,
          changes,
        ))
      ) {
        throw errors.REDIRECT_NOT_FOUND();
      }
    } catch (error) {
      if (isConstraintError(error)) throw errors.REDIRECT_SLUG_TAKEN();
      throw error;
    }
    return ack;
  },
);

export const archiveRedirectProcedure = authed.website.archiveRedirect.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      !(await new CustomRedirectRepository(context.database, context.workspace).archiveRedirect(
        input.id,
      ))
    ) {
      throw errors.REDIRECT_NOT_FOUND();
    }
    return ack;
  },
);

export const redirectProcedures = {
  listRedirects: listRedirectsProcedure,
  createRedirect: createRedirectProcedure,
  updateRedirect: updateRedirectProcedure,
  archiveRedirect: archiveRedirectProcedure,
};
