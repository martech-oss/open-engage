import type { AcquisitionReport } from "@openengage/core/reports";
import { classifyAcquisitionSource } from "@openengage/core/web";
import { AcquisitionReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, type ReportDatabase, type ReportRange } from "./shared";

const metrics = [
  "pageViews",
  "visitors",
  "submissions",
  "submittingContacts",
  "mql",
  "dealsCreated",
  "won",
  "wonValue",
] as const;
const emptyMetrics = () => ({
  pageViews: 0,
  visitors: 0,
  submissions: 0,
  submittingContacts: 0,
  mql: 0,
  dealsCreated: 0,
  won: 0,
  wonValue: 0,
});
export async function acquisitionReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
  currency = "JPY",
): Promise<AcquisitionReport> {
  const repository = new AcquisitionReportsRepository(database);
  const [rows, internalDomains] = await Promise.all([
    repository.sourceMetrics(workspaceId, range, currency),
    repository.internalDomains(workspaceId),
  ]);
  const grouped = new Map<string, AcquisitionReport["sources"][number]>();
  const summary = emptyMetrics();
  for (const row of rows) {
    const source = classifyAcquisitionSource(
      JSON.parse(primitiveString(row.source) || "{}"),
      internalDomains,
    );
    const key = JSON.stringify([source.channel, source.source, source.medium, source.campaign]);
    const result = grouped.get(key) ?? { ...source, ...emptyMetrics() };
    for (const metric of metrics) {
      const value = toFiniteNumber(row[metric]);
      result[metric] += value;
      summary[metric] += value;
    }
    grouped.set(key, result);
  }
  const sources = [...grouped.values()].sort(
    (a, b) =>
      b.wonValue - a.wonValue ||
      b.submissions - a.submissions ||
      b.pageViews - a.pageViews ||
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  return {
    category: "acquisition",
    range: publicRange(range),
    currency,
    attributionModel: "first_retained_touch",
    summary,
    sources,
  };
}
