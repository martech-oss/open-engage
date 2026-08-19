import type { OpenEngageDatabase } from "@openengage/database/client";
import type { ReportDateRange } from "@openengage/database/reports";

export type ReportDatabase = OpenEngageDatabase;

export type ReportRange = ReportDateRange;

export function toReportRange(from: string, to: string): ReportRange {
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return {
    from,
    to,
    fromTimestamp: `${from}T00:00:00.000Z`,
    toExclusiveTimestamp: toExclusive.toISOString(),
  };
}

export function publicRange(range: ReportRange) {
  return { from: range.from, to: range.to };
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}
