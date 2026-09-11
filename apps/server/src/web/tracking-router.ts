import { SiteTrackingRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { isValidDomain, normalizeDomain } from "./domain";
import { VisitorIdentityService } from "./visitor-identity-service";

export const getTrackingProcedure = authed.website.getTracking.handler(({ context }) =>
  new SiteTrackingRepository(context.database, context.workspace).getTracking(),
);

export const updateTrackingProcedure = authed.website.updateTracking.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    // Domains are normalised before validation so "https://Example.com/" is accepted.
    const allowedDomains = input.allowedDomains.map((domain) => normalizeDomain(domain));
    if (allowedDomains.some((domain) => !isValidDomain(domain))) throw errors.INVALID_DOMAIN();
    if (input.enabled && allowedDomains.length === 0) throw errors.TRACKING_DOMAIN_REQUIRED();
    await new SiteTrackingRepository(context.database, context.workspace).saveTrackingSettings({
      enabled: input.enabled,
      allowedDomains,
    });
    return ack;
  },
);

const issueIdentityTokenProcedure = authed.website.issueIdentityToken.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const token = await new VisitorIdentityService(context.database, context.env).issueAssertion(
      context.workspace.workspaceId,
      input.contactId,
    );
    if (!token) throw errors.CONTACT_NOT_FOUND();
    return { token, expiresInSeconds: 600 };
  },
);

export const trackingProcedures = {
  getTracking: getTrackingProcedure,
  updateTracking: updateTrackingProcedure,
  issueIdentityToken: issueIdentityTokenProcedure,
};
