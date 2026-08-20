import type { ReportDateRange as CoreReportDateRange } from "@openengage/core/reports";

export type ReportRow = Record<string, unknown>;

export interface ReportDateRange extends CoreReportDateRange {
  fromTimestamp: string;
  toExclusiveTimestamp: string;
}

export interface DealsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  owners: ReportRow[];
  forecast: ReportRow[];
  taskSummary: ReportRow;
}

export interface ContactsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  topTags: ReportRow[];
  topSegments: ReportRow[];
}

export interface AutomationsSummaryData {
  automations: ReportRow[];
  trend: ReportRow[];
}

export interface EmailsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  sources: ReportRow[];
}

export interface SiteSummaryData {
  pageSummary: ReportRow;
  formSummary: ReportRow;
  trend: ReportRow[];
  topPages: ReportRow[];
  forms: ReportRow[];
  messages: ReportRow[];
}

export interface DashboardSummaryData {
  contacts: ReportRow;
  automations: ReportRow;
  briefs: ReportRow;
  deliveries: ReportRow;
  events: ReportRow[];
}
