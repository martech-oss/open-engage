import { CustomRedirectRepository, isConstraintError, WebRepository } from "@openengage/database";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { isValidDomain, normalizeDomain } from "../public/domain";

export const listFormsProcedure = authed.website.listForms.handler(({ context }) =>
  new WebRepository(context.database, context.workspace).listSignupForms(),
);

export const createFormProcedure = authed.website.createForm.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return new WebRepository(context.database, context.workspace).createSignupForm(input);
  },
);

export const updateFormProcedure = authed.website.updateForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const repository = new WebRepository(context.database, context.workspace);
    if (!(await repository.updateSignupForm(id, changes))) {
      throw errors.FORM_NOT_FOUND();
    }
    return { id };
  },
);

export const archiveFormProcedure = authed.website.archiveForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new WebRepository(context.database, context.workspace);
    if (!(await repository.archiveSignupForm(input.id))) {
      throw errors.FORM_NOT_FOUND();
    }
    return ack;
  },
);

export const listPagesProcedure = authed.website.listPages.handler(({ context }) =>
  new WebRepository(context.database, context.workspace).listLandingPages(),
);

export const createPageProcedure = authed.website.createPage.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return new WebRepository(context.database, context.workspace).createLandingPage(input);
  },
);

export const updatePageProcedure = authed.website.updatePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const outcome = await new WebRepository(context.database, context.workspace).updateLandingPage(
      id,
      changes,
    );
    if (outcome.kind === "not_found") throw errors.PAGE_NOT_FOUND();
    if (outcome.kind === "archived") throw errors.PAGE_ARCHIVED();
    return { id: outcome.id, versionId: outcome.versionId };
  },
);

export const archivePageProcedure = authed.website.archivePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new WebRepository(context.database, context.workspace);
    if (!(await repository.archiveLandingPage(input.id))) {
      throw errors.PAGE_NOT_FOUND();
    }
    return ack;
  },
);

export const listMessagesProcedure = authed.website.listMessages.handler(({ context }) =>
  new WebRepository(context.database, context.workspace).listSiteMessages(),
);

export const createMessageProcedure = authed.website.createMessage.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return new WebRepository(context.database, context.workspace).createSiteMessage(input);
  },
);

export const updateMessageProcedure = authed.website.updateMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const repository = new WebRepository(context.database, context.workspace);
    if (!(await repository.updateSiteMessage(id, changes))) {
      throw errors.SITE_MESSAGE_NOT_FOUND();
    }
    return { id };
  },
);

export const archiveMessageProcedure = authed.website.archiveMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new WebRepository(context.database, context.workspace);
    if (!(await repository.archiveSiteMessage(input.id))) {
      throw errors.SITE_MESSAGE_NOT_FOUND();
    }
    return ack;
  },
);

export const getTrackingProcedure = authed.website.getTracking.handler(({ context }) =>
  new WebRepository(context.database, context.workspace).getTracking(),
);

export const updateTrackingProcedure = authed.website.updateTracking.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    // Domains are normalised before validation so "https://Example.com/" is accepted.
    const allowedDomains = input.allowedDomains.map((domain) => normalizeDomain(domain));
    if (allowedDomains.some((domain) => !isValidDomain(domain))) throw errors.INVALID_DOMAIN();
    if (input.enabled && allowedDomains.length === 0) throw errors.TRACKING_DOMAIN_REQUIRED();
    await new WebRepository(context.database, context.workspace).saveTrackingSettings({
      enabled: input.enabled,
      allowedDomains,
    });
    return ack;
  },
);

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

export const websiteProcedures = {
  listForms: listFormsProcedure,
  createForm: createFormProcedure,
  updateForm: updateFormProcedure,
  archiveForm: archiveFormProcedure,
  listPages: listPagesProcedure,
  createPage: createPageProcedure,
  updatePage: updatePageProcedure,
  archivePage: archivePageProcedure,
  listMessages: listMessagesProcedure,
  createMessage: createMessageProcedure,
  updateMessage: updateMessageProcedure,
  archiveMessage: archiveMessageProcedure,
  listRedirects: listRedirectsProcedure,
  createRedirect: createRedirectProcedure,
  updateRedirect: updateRedirectProcedure,
  archiveRedirect: archiveRedirectProcedure,
  getTracking: getTrackingProcedure,
  updateTracking: updateTrackingProcedure,
};
