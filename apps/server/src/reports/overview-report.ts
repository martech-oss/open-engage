import type { ReportQuery } from "@openengage/core/reports";

import { automationReport } from "./automations-report";
import { contactReport } from "./contacts-report";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { toReportRange, type ReportDatabase } from "./shared";
import { siteReport } from "./site-report";

export async function reportsOverview(
  database: ReportDatabase,
  workspaceId: string,
  input: ReportQuery,
  timeZone = "UTC",
) {
  const range = toReportRange(input.from, input.to, timeZone);
  const [contacts, automations, emails, deals, site] = await Promise.all([
    contactReport(database, workspaceId, range),
    automationReport(database, workspaceId, range),
    emailReport(database, workspaceId, range),
    dealReport(database, workspaceId, range, input.currency),
    siteReport(database, workspaceId, range),
  ]);
  return { contacts, automations, emails, deals, site };
}
