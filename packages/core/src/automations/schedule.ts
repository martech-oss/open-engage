import { workspaceDateTimeToUtc, WorkspaceDateTimeError } from "../shared/time";
import type { AutomationNode, AutomationSchedule } from "./schema.js";
import { automationNumber, automationString } from "./variables";

type DelayNode = Extract<AutomationNode, { type: "delay" }>;

export function computeDueAt(node: DelayNode, now: Date, timezone: string): Date {
  const config = node.config;
  if (config.mode === "relative") {
    return new Date(now.getTime() + automationNumber(config.minutes) * 60_000);
  }
  if (config.mode === "absolute") return new Date(automationString(config.at));

  const candidate = new Date(now.getTime() + automationNumber(config.minutes) * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(candidate)
      .map((part) => [part.type, part.value]),
  );
  const dayEpoch = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  if (
    config.weekdays.includes(new Date(dayEpoch).getUTCDay()) &&
    Number(parts.hour) >= config.startHour &&
    Number(parts.hour) < config.endHour
  )
    return candidate;
  for (let offset = 0; offset <= 14; offset++) {
    const day = new Date(dayEpoch + offset * 86_400_000);
    if (!config.weekdays.includes(day.getUTCDay())) continue;
    for (let hour = config.startHour; hour < config.endHour; hour++) {
      try {
        const start = new Date(
          workspaceDateTimeToUtc(
            `${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`,
            timezone,
          ),
        );
        if (start >= candidate) return start;
      } catch (error) {
        if (!(error instanceof WorkspaceDateTimeError) || error.code !== "nonexistent") throw error;
      }
    }
  }
  throw new Error("Unable to find a delivery window within 14 days");
}

/** Latest due calendar slot in (after, through]; downtime collapses into one run. */
export function latestAutomationSlot(
  schedule: AutomationSchedule,
  after: Date,
  through: Date,
  timezone: string,
): Date | undefined {
  if (schedule.kind === "now") return undefined;
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    return at > after && at <= through ? at : undefined;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (date: Date) =>
    Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const end = parts(through);
  const endDay = Date.UTC(Number(end.year), Number(end.month) - 1, Number(end.day));
  // Monthly/weekly schedules have a slot within 62 days even around DST skips.
  for (let days = 0; days <= 62; days++) {
    const day = new Date(endDay - days * 86_400_000);
    if (schedule.kind === "weekly" && !schedule.weekdays.includes(day.getUTCDay())) continue;
    if (schedule.kind === "monthly") {
      const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      if (day.getUTCDate() !== Math.min(schedule.day, last)) continue;
    }
    const wall = day.getTime() + schedule.hour * 3_600_000 + schedule.minute * 60_000;
    // Discover offsets around the requested local date. Both offsets are retained at
    // DST transitions, then exact wall-time matching skips gaps and chooses fold #1.
    const offsets = new Set<number>();
    for (const delta of [-36, -12, 0, 12, 36]) {
      const probe = new Date(wall + delta * 3_600_000);
      const p = parts(probe);
      offsets.add(
        Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour),
          Number(p.minute),
        ) - probe.getTime(),
      );
    }
    const candidates = [...offsets]
      .map((offset) => new Date(wall - offset))
      .filter((candidate) => {
        const p = parts(candidate);
        return (
          Number(p.year) === day.getUTCFullYear() &&
          Number(p.month) === day.getUTCMonth() + 1 &&
          Number(p.day) === day.getUTCDate() &&
          Number(p.hour) === schedule.hour &&
          Number(p.minute) === schedule.minute
        );
      })
      .sort((a, b) => a.getTime() - b.getTime());
    const slot = candidates[0];
    if (slot && slot <= through) return slot > after ? slot : undefined;
  }
  return undefined;
}
