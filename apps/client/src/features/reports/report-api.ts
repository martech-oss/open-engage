import { queryOptions } from "@tanstack/react-query";

import { formatIsoDate } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import type {
  AutomationsReport,
  CampaignsReport,
  ContactsReport,
  DealsReport,
  EmailsReport,
  ReportCategory,
  SiteReport,
} from "@openengage/core/reports";

export type {
  AutomationsReport,
  CampaignsReport,
  ContactsReport,
  DealsReport,
  EmailsReport,
  SiteReport,
};

export type ReportView = "overview" | ReportCategory;

export interface ReportSearch {
  view: ReportView;
  from: string;
  to: string;
  currency: string;
}

export interface ReportWorkspace {
  view: ReportView;
  contacts?: ContactsReport;
  automations?: AutomationsReport;
  emails?: EmailsReport;
  deals?: DealsReport;
  site?: SiteReport;
  campaigns?: CampaignsReport;
}

export interface ReportClock {
  now: string;
  timeZone: string;
}

export function createReportSearchDefaults(clock: ReportClock): ReportSearch {
  const to = formatIsoDate(new Date(clock.now), clock.timeZone);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return {
    view: "overview",
    from: formatIsoDate(fromDate),
    to,
    currency: "",
  };
}

function isReportView(value: unknown): value is ReportView {
  return (
    value === "overview" ||
    value === "contacts" ||
    value === "automations" ||
    value === "emails" ||
    value === "deals" ||
    value === "site" ||
    value === "campaigns"
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseReportSearch(
  search: Record<string, unknown>,
  defaults: ReportSearch,
): ReportSearch {
  return {
    view: isReportView(search.view) ? search.view : "overview",
    from: isIsoDate(search.from) ? search.from : defaults.from,
    to: isIsoDate(search.to) ? search.to : defaults.to,
    currency: typeof search.currency === "string" ? search.currency : "",
  };
}

export async function loadReportWorkspace(
  search: ReportSearch,
  signal?: AbortSignal,
): Promise<ReportWorkspace> {
  const range = { from: search.from, to: search.to };
  const options = signal ? { signal } : undefined;
  const dealsInput = { ...range, ...(search.currency ? { currency: search.currency } : {}) };

  if (search.view === "overview") {
    const [contacts, automations, emails, deals, site] = await Promise.all([
      orpc.reports.contacts(range, options),
      orpc.reports.automations(range, options),
      orpc.reports.emails(range, options),
      orpc.reports.deals(dealsInput, options),
      orpc.reports.site(range, options),
    ]);
    return { view: search.view, contacts, automations, emails, deals, site };
  }

  switch (search.view) {
    case "contacts":
      return { view: search.view, contacts: await orpc.reports.contacts(range, options) };
    case "automations":
      return { view: search.view, automations: await orpc.reports.automations(range, options) };
    case "emails":
      return { view: search.view, emails: await orpc.reports.emails(range, options) };
    case "deals":
      return { view: search.view, deals: await orpc.reports.deals(dealsInput, options) };
    case "site":
      return { view: search.view, site: await orpc.reports.site(range, options) };
    case "campaigns":
      return { view: search.view, campaigns: await orpc.reports.campaigns(dealsInput, options) };
  }
}

export type DealReportSearch = Pick<ReportSearch, "from" | "to" | "currency">;

export function parseDealReportSearch(
  search: Record<string, unknown>,
  defaults: DealReportSearch,
): DealReportSearch {
  const parsed = parseReportSearch(search, { view: "deals", ...defaults });
  return { from: parsed.from, to: parsed.to, currency: parsed.currency };
}

export function dealReportQueryOptions(search: DealReportSearch) {
  return reportWorkspaceQueryOptions({ view: "deals", ...search });
}

/**
 * No single oRPC procedure returns the whole workspace, so the query key is
 * built by hand instead of via `orpcQuery` — it stays namespaced under
 * "reports"/"workspace" so it can never collide with an oRPC-generated key.
 */
export function reportWorkspaceQueryOptions(search: ReportSearch) {
  return queryOptions({
    queryKey: ["reports", "workspace", search] as const,
    queryFn: ({ signal }) => loadReportWorkspace(search, signal),
  });
}
