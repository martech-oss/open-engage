import { authed, requireRole } from "../orpc/base";
import { automationReport } from "./automations-report";
import { campaignReport } from "./campaigns-report";
import { contactReport } from "./contacts-report";
import { getDashboard } from "./dashboard-service";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { toReportRange } from "./shared";
import { siteReport } from "./site-report";

export const contactsReportProcedure = authed.reports.contacts.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return contactReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to),
    );
  },
);

export const automationsReportProcedure = authed.reports.automations.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return automationReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to),
    );
  },
);

export const emailsReportProcedure = authed.reports.emails.handler(({ context, input, errors }) => {
  requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
  return emailReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
  );
});

export const dealsReportProcedure = authed.reports.deals.handler(({ context, input, errors }) => {
  requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
  return dealReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
    input.currency,
  );
});

export const siteReportProcedure = authed.reports.site.handler(({ context, input, errors }) => {
  requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
  return siteReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
  );
});

export const campaignsReportProcedure = authed.reports.campaigns.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return campaignReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to),
      input.currency ?? "JPY",
    );
  },
);

export const dashboardProcedure = authed.dashboard.get.handler(async ({ context }) => {
  return getDashboard(context.database, context.workspace.workspaceId);
});

export const reportProcedures = {
  contacts: contactsReportProcedure,
  automations: automationsReportProcedure,
  emails: emailsReportProcedure,
  deals: dealsReportProcedure,
  site: siteReportProcedure,
  campaigns: campaignsReportProcedure,
};

export const dashboardProcedures = { get: dashboardProcedure };
