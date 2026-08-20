import { formatIsoDate } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";

/**
 * The trend queries span two weeks so one fetch feeds both the 7-day sparkline
 * and the week-over-week delta beside it — there is no period-comparison
 * endpoint, so the previous week is simply the first half of the same range.
 */
export const TREND_DAYS = 14;
export const TREND_WINDOW = 7;

/** Deal value and task counts are headline figures, quoted over the usual 30-day window. */
const DEAL_SUMMARY_DAYS = 30;

/** ISO date range covering today and the `days - 1` days before it, oldest first. */
function lastDaysRange(days: number): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatIsoDate(from), to: formatIsoDate(today) };
}

export function dashboardQueryOptions() {
  return orpcQuery.dashboard.get.queryOptions();
}

export function deliveryTrendQueryOptions() {
  return orpcQuery.reports.emails.queryOptions({ input: lastDaysRange(TREND_DAYS) });
}

export function contactTrendQueryOptions() {
  return orpcQuery.reports.contacts.queryOptions({ input: lastDaysRange(TREND_DAYS) });
}

export function dealSummaryQueryOptions() {
  return orpcQuery.reports.deals.queryOptions({ input: lastDaysRange(DEAL_SUMMARY_DAYS) });
}

export interface DeliveryHealthPoint {
  day: string;
  delivered: number;
  undelivered: number;
}

/**
 * Sends split into delivered and everything else. The daily trend carries no
 * bounce/deferral breakdown, so the chart stacks a single "未達" band rather
 * than inventing the separate deferred and failed series.
 */
export function toDeliveryHealth(
  trend: Array<{ day: string; sends: number; delivered: number }>,
): DeliveryHealthPoint[] {
  return trend.map((point) => ({
    day: point.day,
    delivered: point.delivered,
    undelivered: Math.max(0, point.sends - point.delivered),
  }));
}

export interface TrendDelta {
  /** Total over the most recent `TREND_WINDOW` days. */
  current: number;
  /** Percentage change against the window before it, or null when that window was empty. */
  changePercent: number | null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Week-over-week movement of a daily series covering {@link TREND_DAYS} days. */
export function windowDelta(daily: number[]): TrendDelta {
  const current = sum(daily.slice(-TREND_WINDOW));
  const previous = sum(daily.slice(-TREND_WINDOW * 2, -TREND_WINDOW));
  return {
    current,
    changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
  };
}

/**
 * Week-over-week movement of a rate, in percentage points — the delivery rate
 * moving from 97.4% to 98.2% reads as +0.8, not as +0.8%-of-97.4.
 */
export function rateDelta(daily: Array<{ sends: number; delivered: number }>): number | null {
  const currentRate = ratioOf(daily.slice(-TREND_WINDOW));
  const previousRate = ratioOf(daily.slice(-TREND_WINDOW * 2, -TREND_WINDOW));
  if (currentRate === null || previousRate === null) return null;
  return Math.round((currentRate - previousRate) * 10) / 10;
}

function ratioOf(points: Array<{ sends: number; delivered: number }>): number | null {
  const sends = sum(points.map((point) => point.sends));
  if (sends === 0) return null;
  return (sum(points.map((point) => point.delivered)) / sends) * 100;
}
