const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type WorkspaceDateTimeErrorCode = "invalid" | "nonexistent";

export class WorkspaceDateTimeError extends Error {
  public override readonly name = "WorkspaceDateTimeError";

  public constructor(
    public readonly code: WorkspaceDateTimeErrorCode,
    public readonly value: string,
    public readonly timeZone: string,
  ) {
    super(
      code === "nonexistent"
        ? `${value} does not exist in ${timeZone}`
        : `${value} is not a valid local date/time`,
    );
  }
}

/**
 * Interprets a timezone-less `datetime-local` value as workspace wall time.
 * A repeated fall-back time resolves to its earlier occurrence; a skipped
 * spring-forward time is rejected instead of silently shifting the schedule.
 */
export function workspaceDateTimeToUtc(value: string, timeZone: string): string {
  const parts = parseLocalDateTime(value, timeZone);
  const wallClockEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const formatter = zonedPartsFormatter(timeZone);
  const offsets = new Set(
    [-7, -1, 0, 1, 7].map((days) => {
      const sample = wallClockEpoch + days * 86_400_000;
      return zonedEpoch(formatter, sample) - sample;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wallClockEpoch - offset)
    .filter((instant) => sameParts(parts, zonedParts(formatter, instant)))
    .sort((left, right) => left - right);
  const instant = candidates[0];
  if (instant === undefined) throw new WorkspaceDateTimeError("nonexistent", value, timeZone);
  return new Date(instant).toISOString();
}

export interface WorkspaceReportDay {
  day: string;
  fromTimestamp: string;
  toExclusiveTimestamp: string;
}

export interface WorkspaceReportDateRange {
  from: string;
  to: string;
  fromTimestamp: string;
  toExclusiveTimestamp: string;
  days: WorkspaceReportDay[];
}

/**
 * Builds half-open UTC boundaries for workspace-local calendar dates. Each
 * labelled day carries its own boundaries so database read models can bucket
 * events correctly across offsets and DST transitions.
 */
export function workspaceReportDateRange(
  from: string,
  to: string,
  timeZone: string,
): WorkspaceReportDateRange {
  const fromEpoch = parseIsoDate(from, timeZone);
  const toEpoch = parseIsoDate(to, timeZone);
  if (fromEpoch > toEpoch) throw new WorkspaceDateTimeError("invalid", `${from}/${to}`, timeZone);

  const days: WorkspaceReportDay[] = [];
  for (let epoch = fromEpoch; epoch <= toEpoch; epoch += 86_400_000) {
    const day = new Date(epoch).toISOString().slice(0, 10);
    const nextDay = new Date(epoch + 86_400_000).toISOString().slice(0, 10);
    days.push({
      day,
      fromTimestamp: workspaceDateTimeToUtc(`${day}T00:00`, timeZone),
      toExclusiveTimestamp: workspaceDateTimeToUtc(`${nextDay}T00:00`, timeZone),
    });
  }
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) throw new WorkspaceDateTimeError("invalid", `${from}/${to}`, timeZone);
  return {
    from,
    to,
    fromTimestamp: first.fromTimestamp,
    toExclusiveTimestamp: last.toExclusiveTimestamp,
    days,
  };
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function parseLocalDateTime(value: string, timeZone: string): LocalDateTimeParts {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw new WorkspaceDateTimeError("invalid", value, timeZone);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").padEnd(3, "0")),
  };
  const normalized = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute ||
    normalized.getUTCSeconds() !== parts.second ||
    normalized.getUTCMilliseconds() !== parts.millisecond
  ) {
    throw new WorkspaceDateTimeError("invalid", value, timeZone);
  }
  return parts;
}

function parseIsoDate(value: string, timeZone: string): number {
  const match = ISO_DATE.exec(value);
  if (!match) throw new WorkspaceDateTimeError("invalid", value, timeZone);
  const epoch = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new WorkspaceDateTimeError("invalid", value, timeZone);
  }
  return epoch;
}

function zonedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  });
}

function zonedParts(formatter: Intl.DateTimeFormat, instant: number): LocalDateTimeParts {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
    millisecond: part("fractionalSecond"),
  };
}

function zonedEpoch(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = zonedParts(formatter, instant);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}
