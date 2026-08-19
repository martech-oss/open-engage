import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * `column LIKE '%<escaped query>%' ESCAPE '\'` — the only correct
 * contains-search over a text column. Always escapes `%`/`_` in `query` so
 * user-typed wildcards are matched literally instead of expanding the search.
 */
export function likeContains(column: SQLWrapper, query: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`;
}

/** D1/Drizzle may wrap SQLite failures; only recognised SQLite constraints are conflicts. */
export function isConstraintError(error: unknown): boolean {
  let current: unknown = error;
  const messages: string[] = [];
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    else if (typeof current === "string") messages.push(current);
    else messages.push(JSON.stringify(current) ?? "");
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return /SQLITE_CONSTRAINT|(?:UNIQUE|FOREIGN KEY|CHECK|NOT NULL) constraint failed/i.test(
    messages.join("\n"),
  );
}

/** The current instant as an ISO-8601 string, for `createdAt`/`updatedAt` columns. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** True when a write matched and changed exactly one row (the common single-row-update case). */
export function changedExactlyOne(result: D1Result): boolean {
  return result.meta.changes === 1;
}

/** True when a write changed at least one row. */
export function didChange(result: D1Result): boolean {
  return result.meta.changes > 0;
}

/** Re-reads a just-written row and throws if it's missing - a bug, not a user-facing error. */
export function ensureLoaded<T>(row: T | null | undefined, what: string): T {
  if (row === null || row === undefined) throw new Error(`${what} could not be loaded`);
  return row;
}
