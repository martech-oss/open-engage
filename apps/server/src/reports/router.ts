import type { OpenEngageDatabase } from "@openengage/database/client";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";

import { authed, requireRole } from "../orpc/base";
import { automationReport } from "./automations-report";
import { campaignReport } from "./campaigns-report";
import { contactReport } from "./contacts-report";
import { getDashboard } from "./dashboard-service";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { reportsOverview } from "./overview-report";
import { toReportRange } from "./shared";
import { siteReport } from "./site-report";

export const reportsOverviewProcedure = authed.reports.overview.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return reportsOverview(context.database, context.workspace.workspaceId, input, timeZone);
  },
);

export const contactsReportProcedure = authed.reports.contacts.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return contactReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
    );
  },
);

export const automationsReportProcedure = authed.reports.automations.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return automationReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
    );
  },
);

export const emailsReportProcedure = authed.reports.emails.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return emailReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
    );
  },
);

export const dealsReportProcedure = authed.reports.deals.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return dealReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
      input.currency,
    );
  },
);

export const siteReportProcedure = authed.reports.site.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return siteReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
    );
  },
);

export const campaignsReportProcedure = authed.reports.campaigns.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const timeZone = await reportTimeZone(context.database, context.workspace.workspaceId);
    return campaignReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to, timeZone),
      input.currency ?? "JPY",
    );
  },
);

export const dashboardProcedure = authed.dashboard.get.handler(async ({ context }) => {
  return getDashboard(context.database, context.workspace.workspaceId);
});

export const reportProcedures = {
  overview: reportsOverviewProcedure,
  contacts: contactsReportProcedure,
  automations: automationsReportProcedure,
  emails: emailsReportProcedure,
  deals: dealsReportProcedure,
  site: siteReportProcedure,
  campaigns: campaignsReportProcedure,
};

export const dashboardProcedures = { get: dashboardProcedure };

async function reportTimeZone(database: OpenEngageDatabase, workspaceId: string): Promise<string> {
  const workspace = await new WorkspaceSettingsRepository(database, { workspaceId }).getWorkspace();
  if (!workspace) throw new Error("Workspace organization could not be loaded");
  return workspace.timezone;
}
