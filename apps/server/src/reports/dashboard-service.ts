import type { Dashboard } from "@openengage/core/reports";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { DashboardReportsRepository } from "@openengage/database/reports";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";

import { toFiniteNumber, parseJsonRecord, primitiveString } from "../platform/values";
import { toReportRange } from "./shared";

const TREND_DAYS = 14;
const TREND_WINDOW = 7;
const TOTAL_DAYS = 30;

export interface DashboardClock {
  now?: string;
}

export async function getDashboard(
  database: OpenEngageDatabase,
  workspaceId: string,
  clock: DashboardClock = {},
): Promise<Dashboard> {
  const asOf = clock.now ? new Date(clock.now).toISOString() : new Date().toISOString();
  const workspace = await new WorkspaceSettingsRepository(database, { workspaceId }).getWorkspace();
  if (!workspace) throw new Error("Workspace organization could not be loaded");

  const trendRange = lastDaysRange(asOf, workspace.timezone, TREND_DAYS);
  const totalsRange = lastDaysRange(asOf, workspace.timezone, TOTAL_DAYS);
  const trendReportRange = toReportRange(trendRange.from, trendRange.to, workspace.timezone);
  const totalsReportRange = toReportRange(totalsRange.from, totalsRange.to, workspace.timezone);
  const summary = await new DashboardReportsRepository(database).dashboardSummary(workspaceId, {
    totals: totalsReportRange,
    trend: trendReportRange,
    asOf,
  });

  const contactPoints = fillDailySeries(
    trendRange,
    summary.contactTrend.map((row) => ({
      day: primitiveString(row["day"]),
      added: toFiniteNumber(row["added"]),
    })),
    (point) => point.added,
    (day, added) => ({ day, added }),
  );
  const deliveryPoints = fillDailySeries(
    trendRange,
    summary.deliveryTrend.map((row) => ({
      day: primitiveString(row["day"]),
      sends: toFiniteNumber(row["sends"]),
      delivered: toFiniteNumber(row["delivered"]),
    })),
    (point) => ({ sends: point.sends, delivered: point.delivered }),
    (day, value) => ({
      day,
      sends: value.sends,
      delivered: value.delivered,
      undelivered: Math.max(0, value.sends - value.delivered),
    }),
    { sends: 0, delivered: 0 },
  );
  const openCount = toFiniteNumber(summary.deals["open_count"]);
  const openValue = toFiniteNumber(summary.deals["open_value"]);
  const sent = toFiniteNumber(summary.deliveries["sent"]);
  const delivered = toFiniteNumber(summary.deliveries["delivered"]);
  const recentEvents = summary.events.map((row) => ({
    type: primitiveString(row["type"]),
    occurredAt: primitiveString(row["occurred_at"]),
    contactId: row["contact_id"] === null ? null : primitiveString(row["contact_id"]),
    properties: parseJsonRecord(row["properties"]),
  }));

  return {
    asOf,
    timezone: workspace.timezone,
    contacts: {
      count: toFiniteNumber(summary.contacts["count"]),
      trend: { ...trendRange, points: contactPoints },
      changePercent: windowChange(contactPoints.map((point) => point.added)),
    },
    automations: {
      count: toFiniteNumber(summary.automations["count"]),
      draftCount: toFiniteNumber(summary.automations["draft_count"]),
      enrolledCount: toFiniteNumber(summary.automations["enrolled_count"]),
      top: summary.topAutomations.map((row) => ({
        id: primitiveString(row["id"]),
        name: primitiveString(row["name"]),
        active: toFiniteNumber(row["active"]),
        completed: toFiniteNumber(row["completed"]),
        updatedAt: primitiveString(row["updated_at"]),
      })),
    },
    briefs: { overdueReviews: toFiniteNumber(summary.briefs["overdue_reviews"]) },
    deliveries: {
      sent,
      delivered,
      failed: toFiniteNumber(summary.deliveries["failed"]),
      deliveryRate: sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0,
      totalsRange,
      health: { ...trendRange, points: deliveryPoints },
      sendChangePercent: windowChange(deliveryPoints.map((point) => point.sends)),
      deliveryRateChangePoints: rateChange(deliveryPoints),
    },
    deals: {
      range: totalsRange,
      currency: primitiveString(summary.deals["currency"]),
      created: toFiniteNumber(summary.deals["created"]),
      openCount,
      openValue,
      averageOpenValue: openCount > 0 ? openValue / openCount : 0,
      openTasks: toFiniteNumber(summary.tasks["open_tasks"]),
      overdueTasks: toFiniteNumber(summary.tasks["overdue_tasks"]),
      completedTasks: toFiniteNumber(summary.tasks["completed_tasks"]),
    },
    recentEvents,
    recentActivity: recentEvents.slice(0, 12),
  };
}

interface DateRange {
  from: string;
  to: string;
}

function lastDaysRange(asOf: string, timeZone: string, days: number): DateRange {
  const to = workspaceDate(new Date(asOf), timeZone);
  return { from: shiftIsoDate(to, -(days - 1)), to };
}

function workspaceDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftIsoDate(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function fillDailySeries<Source extends { day: string }, Value, Result>(
  range: DateRange,
  source: Source[],
  select: (source: Source) => Value,
  build: (day: string, value: Value) => Result,
  zero: Value = 0 as Value,
): Result[] {
  const values = new Map(source.map((point) => [point.day, select(point)]));
  const points: Result[] = [];
  for (let day = range.from; day <= range.to; day = shiftIsoDate(day, 1)) {
    points.push(build(day, values.get(day) ?? zero));
  }
  return points;
}

function windowChange(values: number[]): number | null {
  const current = sum(values.slice(-TREND_WINDOW));
  const previous = sum(values.slice(-TREND_WINDOW * 2, -TREND_WINDOW));
  return previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
}

function rateChange(points: Array<{ sends: number; delivered: number }>): number | null {
  const current = deliveryRate(points.slice(-TREND_WINDOW));
  const previous = deliveryRate(points.slice(-TREND_WINDOW * 2, -TREND_WINDOW));
  return current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;
}

function deliveryRate(points: Array<{ sends: number; delivered: number }>): number | null {
  const sends = sum(points.map((point) => point.sends));
  return sends > 0 ? (sum(points.map((point) => point.delivered)) / sends) * 100 : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
