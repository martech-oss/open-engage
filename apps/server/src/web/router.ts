import { siteMessageScheduleSchema } from "@openengage/core/web";
import { isConstraintError, isUniqueConstraintError } from "@openengage/database/shared";
import { CustomRedirectRepository, WebRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { availableSlug } from "../workspaces/slug-service";
import { hasTurnstileConfiguration } from "./config";
import { isValidDomain, normalizeDomain } from "./domain";

const FORM_SLUG_UNIQUE_COLUMNS = ["forms.workspace_id", "forms.slug"] as const;
const PAGE_SLUG_UNIQUE_COLUMNS = ["landing_pages.workspace_id", "landing_pages.slug"] as const;

export const listFormsProcedure = authed.website.listForms.handler(({ context }) =>
  new WebRepository(context.database, context.workspace).listSignupForms(),
);

export const createFormProcedure = authed.website.createForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      input.status === "published" &&
      input.turnstileEnabled &&
      !hasTurnstileConfiguration(context.env)
    ) {
      throw errors.TURNSTILE_NOT_CONFIGURED();
    }
    const repository = new WebRepository(context.database, context.workspace);
    let slug =
      input.slug ??
      (await availableSlug(input.name, "signup-form", (candidate) =>
        repository.isSignupFormSlugAvailable(candidate),
      ));
    for (;;) {
      try {
        return await repository.createSignupForm({ ...input, slug });
      } catch (error) {
        if (!isUniqueConstraintError(error, FORM_SLUG_UNIQUE_COLUMNS)) throw error;
        if (input.slug) throw errors.FORM_SLUG_TAKEN({ cause: error });
        slug = await availableSlug(input.name, "signup-form", (candidate) =>
          repository.isSignupFormSlugAvailable(candidate),
        );
      }
    }
  },
);

export const updateFormProcedure = authed.website.updateForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      input.status === "published" &&
      input.turnstileEnabled &&
      !hasTurnstileConfiguration(context.env)
    ) {
      throw errors.TURNSTILE_NOT_CONFIGURED();
    }
    const { id, ...changes } = input;
    const repository = new WebRepository(context.database, context.workspace);
    try {
      if (!(await repository.updateSignupForm(id, changes))) {
        throw errors.FORM_NOT_FOUND();
      }
    } catch (error) {
      if (isUniqueConstraintError(error, FORM_SLUG_UNIQUE_COLUMNS)) {
        throw errors.FORM_SLUG_TAKEN({ cause: error });
      }
      throw error;
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
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new WebRepository(context.database, context.workspace);
    let slug =
      input.slug ??
      (await availableSlug(input.name, "landing-page", (candidate) =>
        repository.isLandingPageSlugAvailable(candidate),
      ));
    for (;;) {
      try {
        return await repository.createLandingPage({ ...input, slug });
      } catch (error) {
        if (!isUniqueConstraintError(error, PAGE_SLUG_UNIQUE_COLUMNS)) throw error;
        if (input.slug) throw errors.PAGE_SLUG_TAKEN({ cause: error });
        slug = await availableSlug(input.name, "landing-page", (candidate) =>
          repository.isLandingPageSlugAvailable(candidate),
        );
      }
    }
  },
);

export const updatePageProcedure = authed.website.updatePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    let outcome;
    try {
      outcome = await new WebRepository(context.database, context.workspace).updateLandingPage(
        id,
        changes,
      );
    } catch (error) {
      if (isUniqueConstraintError(error, PAGE_SLUG_UNIQUE_COLUMNS)) {
        throw errors.PAGE_SLUG_TAKEN({ cause: error });
      }
      throw error;
    }
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
    if (!siteMessageScheduleSchema.safeParse(input).success) {
      throw errors.SITE_MESSAGE_SCHEDULE_INVALID();
    }
    return new WebRepository(context.database, context.workspace).createSiteMessage(input);
  },
);

export const updateMessageProcedure = authed.website.updateMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!siteMessageScheduleSchema.safeParse(input).success) {
      throw errors.SITE_MESSAGE_SCHEDULE_INVALID();
    }
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
