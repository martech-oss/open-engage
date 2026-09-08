import { type ReportWorkspace } from "@/features/reports/report-api";

export function reportExport(
  data: ReportWorkspace,
): { filename: string; rows: Array<Record<string, string | number>> } | null {
  if (data.view === "contacts" && data.contacts) {
    return {
      filename: "contacts-report.csv",
      rows: data.contacts.trend.map((row) => ({
        date: row.day,
        contacts_added: row.added,
        contacts_archived: row.archived,
      })),
    };
  }
  if (data.view === "automations" && data.automations) {
    return {
      filename: "automations-report.csv",
      rows: data.automations.automations.map((row) => ({
        automation: row.name,
        status: row.status,
        entries: row.entries,
        completions: row.completions,
        active_contacts: row.activeContacts,
        email_sends: row.sends,
        unique_opens: row.opens,
        unique_clicks: row.clicks,
      })),
    };
  }
  if (data.view === "emails" && data.emails) {
    return {
      filename: "emails-report.csv",
      rows: data.emails.sources.map((row) => ({
        source: row.name,
        type: row.type,
        sends: row.sends,
        delivered: row.delivered,
        opens: row.opens,
        clicks: row.clicks,
        bounces: row.bounces,
        unsubscribes: row.unsubscribes,
      })),
    };
  }
  if (data.view === "deals" && data.deals) {
    return {
      filename: "deals-report.csv",
      rows: data.deals.owners.map((row) => ({
        owner: row.name,
        currency: data.deals!.currency,
        created: row.created,
        won: row.won,
        lost: row.lost,
        open: row.openCount,
        won_value: row.wonValue,
      })),
    };
  }
  if (data.view === "site" && data.site) {
    return {
      filename: "site-report.csv",
      rows: data.site.topPages.map((row) => ({
        url: row.url,
        page_views: row.views,
        unique_visitors: row.uniqueVisitors,
        identified_contacts: row.identifiedContacts,
      })),
    };
  }
  if (data.view === "campaigns" && data.campaigns)
    return {
      filename: "campaign-roi.csv",
      rows: data.campaigns.campaigns.map((row) => ({
        campaign: row.name,
        currency: data.campaigns!.currency,
        attribution_model: data.campaigns!.attributionModel,
        cost: row.cost,
        attributed_revenue: row.attributedValue,
        roi_percent: row.roi ?? "算出不可",
        influenced_revenue_reference: row.influencedValue,
      })),
    };
  if (data.view === "lifecycle" && data.lifecycle)
    return {
      filename: "lifecycle-cohorts.csv",
      rows: data.lifecycle.cohorts.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? "算出不可"])),
      ),
    };
  return null;
}
