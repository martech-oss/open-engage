import { ReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

export async function siteReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ReportsRepository(database).siteSummary(workspaceId, range);
  const pageSummary = data.pageSummary;
  const formSummary = data.formSummary;
  const pageViews = toFiniteNumber(pageSummary["page_views"]);
  const uniqueVisitors = toFiniteNumber(pageSummary["unique_visitors"]);
  const identifiedContacts = toFiniteNumber(pageSummary["identified_contacts"]);
  const messages = data.messages.map((row) => {
    const impressions = toFiniteNumber(row["impression_count"]);
    const clicks = toFiniteNumber(row["click_count"]);
    return {
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      status: primitiveString(row["status"]),
      impressions,
      clicks,
      clickRate: rate(clicks, impressions),
    };
  });
  return {
    category: "site" as const,
    range: publicRange(range),
    summary: {
      pageViews,
      uniqueVisitors,
      identifiedContacts,
      identificationRate: rate(identifiedContacts, uniqueVisitors),
      submissions: toFiniteNumber(formSummary["submissions"]),
      submittingContacts: toFiniteNumber(formSummary["submitting_contacts"]),
      messageImpressions: messages.reduce((sum, message) => sum + message.impressions, 0),
      messageClicks: messages.reduce((sum, message) => sum + message.clicks, 0),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      pageViews: toFiniteNumber(row["page_views"]),
      submissions: toFiniteNumber(row["submissions"]),
    })),
    topPages: data.topPages.map((row) => ({
      url: primitiveString(row["url"]),
      views: toFiniteNumber(row["views"]),
      uniqueVisitors: toFiniteNumber(row["unique_visitors"]),
      identifiedContacts: toFiniteNumber(row["identified_contacts"]),
    })),
    forms: data.forms.map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      status: primitiveString(row["status"]),
      submissions: toFiniteNumber(row["submissions"]),
      contacts: toFiniteNumber(row["contacts"]),
    })),
    messages,
    notes: {
      messageMetrics: "サイトメッセージの表示・クリックは累計値です",
    },
  };
}
