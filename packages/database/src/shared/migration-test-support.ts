import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

const journal = JSON.parse(
  readFileSync(resolve(migrationsDirectory, "meta/_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string }[] };

const migrationFiles = [...journal.entries]
  .sort((left, right) => left.idx - right.idx)
  .map((entry) => `${entry.tag}.sql`);

/** Migration files numbered from `first` up to, not including, `end` (four-digit prefixes). */
export function migrationRange(first: string, end?: string): string[] {
  return migrationFiles.filter((file) => file >= first && (end === undefined || file < end));
}

/** Applies migration files in order, as a database created at that release would have. */
export function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}
