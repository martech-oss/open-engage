import { LandingPageRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { landingDesignProcedures } from "./landing-router";
import { PageCommandService } from "./page-command-service";

export const listPagesProcedure = authed.website.listPages.handler(({ context }) =>
  new LandingPageRepository(context.database, context.workspace).listLandingPages(),
);

export const createPageProcedure = authed.website.createPage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await new PageCommandService(
      context.database,
      context.workspace,
      context.env,
    ).create(input);
    switch (outcome.kind) {
      case "ok":
        return { id: outcome.id, versionId: outcome.versionId };
      case "invalid":
        throw errors.PAGE_INVALID({ cause: outcome.cause });
      case "slug_taken":
        throw errors.PAGE_SLUG_TAKEN({ cause: outcome.cause });
    }
  },
);

export const updatePageProcedure = authed.website.updatePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await new PageCommandService(
      context.database,
      context.workspace,
      context.env,
    ).update(input);
    switch (outcome.kind) {
      case "ok":
        return { id: outcome.id, versionId: outcome.versionId };
      case "invalid":
        throw errors.PAGE_INVALID({ cause: outcome.cause });
      case "slug_taken":
        throw errors.PAGE_SLUG_TAKEN({ cause: outcome.cause });
      case "not_found":
        throw errors.PAGE_NOT_FOUND();
      case "archived":
        throw errors.PAGE_ARCHIVED();
      case "conflict":
        throw errors.PAGE_CONFLICT({ cause: outcome.cause });
    }
  },
);

export const archivePageProcedure = authed.website.archivePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new LandingPageRepository(context.database, context.workspace);
    if (!(await repository.archiveLandingPage(input.id))) throw errors.PAGE_NOT_FOUND();
    return ack;
  },
);

export const pageProcedures = {
  ...landingDesignProcedures,
  listPages: listPagesProcedure,
  createPage: createPageProcedure,
  updatePage: updatePageProcedure,
  archivePage: archivePageProcedure,
};
