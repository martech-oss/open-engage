import { CampaignReportRepository } from "@openengage/database/projects";

import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

/**
 * Campaign performance keyed on projects. The three revenue columns answer
 * different questions and must not be summed together: influenced credits every
 * project that touched a won deal, while first- and last-touch each split the
 * same revenue exactly once.
 */
export async function campaignReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
  currency: string,
  attributionModel: "first_touch" | "last_touch" = "last_touch",
) {
  const rows = await new CampaignReportRepository(database).attribution(
    workspaceId,
    range,
    currency,
  );
  const totals = rows.reduce(
    (total, row) => ({
      touches: total.touches + row.touches,
      contacts: total.contacts + row.contacts,
      influencedDeals: total.influencedDeals + row.influencedDeals,
      firstTouchValue: total.firstTouchValue + row.firstTouchValue,
      lastTouchValue: total.lastTouchValue + row.lastTouchValue,
      cost: total.cost + row.cost,
    }),
    { touches: 0, contacts: 0, influencedDeals: 0, firstTouchValue: 0, lastTouchValue: 0, cost: 0 },
  );
  return {
    category: "campaigns" as const,
    range: publicRange(range),
    currency,
    attributionModel,
    summary: {
      campaigns: rows.length,
      activeCampaigns: rows.filter((row) => row.touches > 0).length,
      ...totals,
      attributedValue:
        attributionModel === "first_touch" ? totals.firstTouchValue : totals.lastTouchValue,
      roi: roi(
        attributionModel === "first_touch" ? totals.firstTouchValue : totals.lastTouchValue,
        totals.cost,
      ),
    },
    campaigns: rows.map((row) => ({
      id: row.projectId,
      name: row.projectName,
      color: row.color,
      touches: row.touches,
      contacts: row.contacts,
      influencedDeals: row.influencedDeals,
      influencedValue: row.influencedValue,
      firstTouchValue: row.firstTouchValue,
      lastTouchValue: row.lastTouchValue,
      cost: row.cost,
      attributedValue:
        attributionModel === "first_touch" ? row.firstTouchValue : row.lastTouchValue,
      roi: roi(
        attributionModel === "first_touch" ? row.firstTouchValue : row.lastTouchValue,
        row.cost,
      ),
      touchesPerContact: row.contacts > 0 ? rate(row.touches, row.contacts) : 0,
    })),
  };
}

function roi(revenue: number, cost: number): number | null {
  return cost > 0 ? Math.round(((revenue - cost) / cost) * 10000) / 100 : null;
}
