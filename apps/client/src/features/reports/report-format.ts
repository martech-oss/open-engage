import { formatPercent, rate } from "@/lib/format";

/** Distinguish an unmeasurable rate from a measured zero. */
export function formatReportRate(percentage: number, denominator: number): string {
  return denominator > 0 ? formatPercent(percentage) : "—";
}

export function formatReportRatio(numerator: number, denominator: number): string {
  return formatReportRate(rate(numerator, denominator), denominator);
}
