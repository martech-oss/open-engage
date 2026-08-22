import type { QueryFunction, QueryKey } from "@tanstack/react-query";

import { formatIsoDate } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";
import type {
  AutomationsReport,
  CampaignsReport,
  ContactsReport,
  DealsReport,
  EmailsReport,
  ReportCategory,
  ReportsOverview,
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

type ReportQueryOutput =
  | ReportsOverview
  | ContactsReport
  | AutomationsReport
  | EmailsReport
  | DealsReport
  | SiteReport
  | CampaignsReport;

interface ReportQueryOptions {
  queryKey: QueryKey;
  queryFn: QueryFunction<ReportQueryOutput>;
  select: (output: ReportQueryOutput) => ReportWorkspace;
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

export function reportWorkspaceQueryOptions(search: ReportSearch): ReportQueryOptions {
  const range = { from: search.from, to: search.to };
  const dealsInput = { ...range, ...(search.currency ? { currency: search.currency } : {}) };

  switch (search.view) {
    case "overview":
      return withWorkspaceSelection(orpcQuery.reports.overview.queryOptions({ input: dealsInput }));
    case "contacts":
      return withWorkspaceSelection(orpcQuery.reports.contacts.queryOptions({ input: range }));
    case "automations":
      return withWorkspaceSelection(orpcQuery.reports.automations.queryOptions({ input: range }));
    case "emails":
      return withWorkspaceSelection(orpcQuery.reports.emails.queryOptions({ input: range }));
    case "deals":
      return withWorkspaceSelection(orpcQuery.reports.deals.queryOptions({ input: dealsInput }));
    case "site":
      return withWorkspaceSelection(orpcQuery.reports.site.queryOptions({ input: range }));
    case "campaigns":
      return withWorkspaceSelection(
        orpcQuery.reports.campaigns.queryOptions({ input: dealsInput }),
      );
  }
}

function withWorkspaceSelection<Output extends ReportQueryOutput>(generated: {
  queryKey: QueryKey;
  queryFn: QueryFunction<Output>;
}): ReportQueryOptions {
  return {
    ...generated,
    queryFn: generated.queryFn,
    select: toReportWorkspace,
  };
}

function toReportWorkspace(output: ReportQueryOutput): ReportWorkspace {
  if ("contacts" in output) return { view: "overview", ...output };
  switch (output.category) {
    case "contacts":
      return { view: output.category, contacts: output };
    case "automations":
      return { view: output.category, automations: output };
    case "emails":
      return { view: output.category, emails: output };
    case "deals":
      return { view: output.category, deals: output };
    case "site":
      return { view: output.category, site: output };
    case "campaigns":
      return { view: output.category, campaigns: output };
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
