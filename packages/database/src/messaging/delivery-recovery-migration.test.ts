/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const migrationsBefore0013 = [
  "0000_quick_ender_wiggin.sql",
  "0001_workable_hitman.sql",
  "0002_breezy_photon.sql",
  "0003_faulty_hobgoblin.sql",
  "0004_groovy_pete_wisdom.sql",
  "0005_swift_microchip.sql",
  "0006_red_crusher_hogan.sql",
  "0007_clumsy_bloodscream.sql",
  "0008_polite_pete_wisdom.sql",
  "0009_chemical_loki.sql",
  "0010_giant_bishop.sql",
  "0011_condemned_rocket_raccoon.sql",
  "0012_keen_boom_boom.sql",
] as const;

describe("delivery and import recovery migration 0013", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("backfills legacy sending deliveries channel-safely and resumes the persisted import cursor", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationsBefore0013);
    database.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('workspace', 'Workspace', 'workspace', 1);
      INSERT INTO import_jobs
        (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
      VALUES (
        'import', 'workspace', 'contact_import', 'imports/import', 'processing',
        '{"part":1,"totalParts":3}', '2026-01-01', '2026-01-01'
      );
      INSERT INTO deliveries
        (id, workspace_id, channel, purpose, provider, idempotency_key, payload,
         status, attempts, created_at, updated_at)
      VALUES
        ('email', 'workspace', 'email', 'transactional', 'cloudflare', 'email-key', '{}',
         'sending', 1, '2026-01-01', '2026-01-01'),
        ('webhook', 'workspace', 'webhook', 'transactional', 'webhook', 'webhook-key', '{}',
         'sending', 4, '2026-01-01', '2026-01-01'),
        ('webhook-exhausted', 'workspace', 'webhook', 'transactional', 'webhook',
         'webhook-exhausted-key', '{}', 'sending', 5, '2026-01-01', '2026-01-01');
    `);

    applyMigrations(database, ["0013_omniscient_jasper_sitwell.sql"]);

    expect(
      database
        .prepare("SELECT id, status, last_error AS lastError FROM deliveries ORDER BY id")
        .all(),
    ).toEqual([
      { id: "email", status: "failed", lastError: "outcome_unknown" },
      { id: "webhook", status: "queued", lastError: "legacy_sending_recovered" },
      { id: "webhook-exhausted", status: "failed", lastError: "attempts_exhausted" },
    ]);
    expect(
      database
        .prepare(
          `SELECT job_id AS jobId, part, total_parts AS totalParts, status
           FROM contact_import_parts WHERE job_id = 'import'`,
        )
        .get(),
    ).toEqual({ jobId: "import", part: 1, totalParts: 3, status: "pending" });
  });
});

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}
