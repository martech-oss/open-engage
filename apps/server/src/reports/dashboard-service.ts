import type { Dashboard } from "@openengage/core/reports";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ReportsRepository } from "@openengage/database/reports";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";

import { listAutomations } from "../automations/list-service";
import { toFiniteNumber, parseJsonRecord, primitiveString } from "../platform/values";
import { contactReport } from "./contacts-report";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { toReportRange } from "./shared";

const TREND_DAYS = 14;
const TREND_WINDOW = 7;
const TOTAL_DAYS = 30;
const TOP_AUTOMATIONS = 6;

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
  const trendReportRange = toWorkspaceReportRange(
    trendRange.from,
    trendRange.to,
    workspace.timezone,
  );
  const totalsReportRange = toWorkspaceReportRange(
    totalsRange.from,
    totalsRange.to,
    workspace.timezone,
  );
  const [summary, contacts, emails, deals, automations] = await Promise.all([
    new ReportsRepository(database).dashboardSummary(workspaceId, {
      fromTimestamp: totalsReportRange.fromTimestamp,
      toExclusiveTimestamp: totalsReportRange.toExclusiveTimestamp,
      asOf,
    }),
    contactReport(database, workspaceId, trendReportRange),
    emailReport(database, workspaceId, trendReportRange),
    dealReport(database, workspaceId, totalsReportRange),
    listAutomations(database, workspaceId),
  ]);

  const contactPoints = fillDailySeries(
    trendRange,
    contacts.trend,
    (point) => point.added,
    (day, added) => ({ day, added }),
  );
  const deliveryPoints = fillDailySeries(
    trendRange,
    emails.trend,
    (point) => ({ sends: point.sends, delivered: point.delivered }),
    (day, value) => ({
      day,
      sends: value.sends,
      delivered: value.delivered,
      undelivered: Math.max(0, value.sends - value.delivered),
    }),
    { sends: 0, delivered: 0 },
  );
  const rankedAutomations = automations
    .filter((automation) => automation.status === "active")
    .sort(
      (left, right) =>
        right.activeCount - left.activeCount || right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, TOP_AUTOMATIONS);
  const openCount = deals.summary.openCount;
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
      draftCount: automations.filter((automation) => automation.status === "draft").length,
      enrolledCount: automations.reduce((total, automation) => total + automation.activeCount, 0),
      top: rankedAutomations.map((automation) => ({
        id: automation.id,
        name: automation.name,
        active: automation.activeCount,
        completed: automation.completedCount,
        updatedAt: automation.updatedAt,
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
      currency: deals.currency,
      created: deals.summary.created,
      openCount,
      openValue: deals.summary.openValue,
      averageOpenValue: openCount > 0 ? deals.summary.openValue / openCount : 0,
      openTasks: deals.summary.openTasks,
      overdueTasks: deals.summary.overdueTasks,
      completedTasks: deals.summary.completedTasks,
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

function toWorkspaceReportRange(from: string, to: string, timeZone: string) {
  return {
    ...toReportRange(from, to),
    fromTimestamp: workspaceMidnight(from, timeZone),
    toExclusiveTimestamp: workspaceMidnight(shiftIsoDate(to, 1), timeZone),
  };
}

function workspaceMidnight(day: string, timeZone: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const desiredLocalTime = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
  let instant = desiredLocalTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    const representedLocalTime = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    const adjustment = desiredLocalTime - representedLocalTime;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant).toISOString();
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
