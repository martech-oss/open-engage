import { EmailsReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

export async function emailReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new EmailsReportsRepository(database).emailsSummary(workspaceId, range);
  const summaryRow = data.summary;
  const summary = {
    sends: toFiniteNumber(summaryRow["sends"]),
    delivered: toFiniteNumber(summaryRow["delivered"]),
    opens: toFiniteNumber(summaryRow["opens"]),
    clicks: toFiniteNumber(summaryRow["clicks"]),
    bounces: toFiniteNumber(summaryRow["bounces"]),
    unsubscribes: toFiniteNumber(summaryRow["unsubscribes"]),
    complaints: toFiniteNumber(summaryRow["complaints"]),
  };
  return {
    category: "emails" as const,
    range: publicRange(range),
    summary: {
      ...summary,
      deliveryRate: rate(summary.delivered, summary.sends),
      openRate: rate(summary.opens, summary.delivered),
      clickRate: rate(summary.clicks, summary.delivered),
      clickToOpenRate: rate(summary.clicks, summary.opens),
      bounceRate: rate(summary.bounces, summary.sends),
      unsubscribeRate: rate(summary.unsubscribes, summary.delivered),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      sends: toFiniteNumber(row["sends"]),
      delivered: toFiniteNumber(row["delivered"]),
      opens: toFiniteNumber(row["opens"]),
      clicks: toFiniteNumber(row["clicks"]),
    })),
    sources: data.sources.map((row) => {
      const sends = toFiniteNumber(row["sends"]);
      const delivered = toFiniteNumber(row["delivered"]);
      const opens = toFiniteNumber(row["opens"]);
      const clicks = toFiniteNumber(row["clicks"]);
      return {
        id: primitiveString(row["source_id"]),
        name: primitiveString(row["source_name"]),
        type: primitiveString(row["source_type"]),
        sends,
        delivered,
        opens,
        clicks,
        bounces: toFiniteNumber(row["bounces"]),
        unsubscribes: toFiniteNumber(row["unsubscribes"]),
        openRate: rate(opens, delivered),
        clickRate: rate(clicks, delivered),
      };
    }),
  };
}
