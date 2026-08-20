import { ReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

export async function automationReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ReportsRepository(database).automationsSummary(workspaceId, range);
  const automations = data.automations.map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    status: primitiveString(row["status"]),
    entries: toFiniteNumber(row["entries"]),
    completions: toFiniteNumber(row["completions"]),
    activeContacts: toFiniteNumber(row["active_contacts"]),
    sends: toFiniteNumber(row["sends"]),
    opens: toFiniteNumber(row["opens"]),
    clicks: toFiniteNumber(row["clicks"]),
  }));
  const totals = automations.reduce(
    (total, automation) => ({
      entries: total.entries + automation.entries,
      completions: total.completions + automation.completions,
      activeContacts: total.activeContacts + automation.activeContacts,
      sends: total.sends + automation.sends,
      opens: total.opens + automation.opens,
      clicks: total.clicks + automation.clicks,
    }),
    { entries: 0, completions: 0, activeContacts: 0, sends: 0, opens: 0, clicks: 0 },
  );
  return {
    category: "automations" as const,
    range: publicRange(range),
    summary: {
      automationCount: automations.length,
      ...totals,
      completionRate: rate(totals.completions, totals.entries),
      openRate: rate(totals.opens, totals.sends),
      clickRate: rate(totals.clicks, totals.sends),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      entries: toFiniteNumber(row["entries"]),
      completions: toFiniteNumber(row["completions"]),
    })),
    automations,
  };
}
