import { isUniqueConstraintError } from "@openengage/database/shared";
import { CustomRedirectRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";

const REDIRECT_SLUG_UNIQUE_COLUMNS = [
  "custom_redirects.workspace_id",
  "custom_redirects.slug",
] as const;

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
      if (isUniqueConstraintError(error, REDIRECT_SLUG_UNIQUE_COLUMNS))
        throw errors.REDIRECT_SLUG_TAKEN();
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
      if (isUniqueConstraintError(error, REDIRECT_SLUG_UNIQUE_COLUMNS))
        throw errors.REDIRECT_SLUG_TAKEN();
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
