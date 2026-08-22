import { workspaceReportDateRange } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import type { ReportDateRange } from "@openengage/database/reports";

export type ReportDatabase = OpenEngageDatabase;

export type ReportRange = ReportDateRange;

export function toReportRange(from: string, to: string, timeZone = "UTC"): ReportRange {
  return workspaceReportDateRange(from, to, timeZone);
}

export function publicRange(range: ReportRange) {
  return { from: range.from, to: range.to };
}

export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}
