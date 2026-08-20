/**
 * Shared display formatters.
 *
 * The date helpers render deliberately different shapes, so they are separate
 * functions rather than one parameterised helper. Each is documented with the
 * exact output it produces for 2026-07-30T14:05:00Z in Asia/Tokyo — pick by
 * that, not by name similarity.
 */

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const longDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

const monthDayTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
});

/** `2026年7月30日` */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** `2026年7月30日 23:05` */
export function formatLongDateTime(value: string): string {
  return longDateTimeFormatter.format(new Date(value));
}

/** `2026/07/30 23:05` */
export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** `7月30日 23:05` — omits the year, for dates close to now such as task due dates. */
export function formatMonthDayTime(value: string): string {
  return monthDayTimeFormatter.format(new Date(value));
}

/** `7/30` — takes a date-only `YYYY-MM-DD` string and reads it as local midnight. */
export function formatShortDate(value: string): string {
  return shortDateFormatter.format(new Date(`${value}T00:00:00`));
}

/** `2026-07-30` — UTC calendar date for API report/query range inputs. */
export function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["month", 2_592_000_000],
  ["year", 31_536_000_000],
];

/**
 * `3分前` — coarse "how long ago" for activity feeds, where the exact clock
 * time matters less than the recency. Use {@link formatDateTime} when the
 * reader needs the actual timestamp.
 */
export function formatRelativeTime(value: string): string {
  const elapsed = new Date(value).getTime() - Date.now();
  if (Number.isNaN(elapsed)) return "";
  let [unit, size] = RELATIVE_UNITS[0]!;
  for (const [candidateUnit, candidateSize] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) < candidateSize) break;
    [unit, size] = [candidateUnit, candidateSize];
  }
  return relativeTimeFormatter.format(Math.round(elapsed / size), unit);
}

/** `¥1,234` for JPY, `$1,234.00` otherwise. Falls back to plain text on an unknown currency code. */
export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

/** `12.34%` — expects an already-computed percentage, not a 0..1 ratio. See {@link rate}. */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
}

/** Percentage of `numerator` over `denominator`, rounded to 2 decimals. Zero when `denominator` is 0. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

/** Formats an ISO timestamp for a `<input type="datetime-local">` value, in the viewer's timezone. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
