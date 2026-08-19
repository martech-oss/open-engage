/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const migrationFiles = [
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

describe("contact projection migration 0012", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("backfills six projection rows only for unfinished outbox work", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationFiles.slice(0, 12));
    database.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('workspace', 'Workspace', 'workspace', 1);
      INSERT INTO contact_events (id, workspace_id, type, properties, occurred_at, created_at)
      VALUES ('pending-event', 'workspace', 'page_viewed', '{}', '2026-01-01', '2026-01-01'),
             ('processed-event', 'workspace', 'page_viewed', '{}', '2026-01-01', '2026-01-01');
      INSERT INTO contact_event_outbox
        (event_id, workspace_id, status, created_at, processed_at)
      VALUES ('pending-event', 'workspace', 'pending', '2026-01-01', NULL),
             ('processed-event', 'workspace', 'processed', '2026-01-01', '2026-01-01');
    `);

    applyMigrations(database, migrationFiles.slice(12));

    expect(
      database
        .prepare(
          `SELECT projection, status FROM contact_event_projections
           WHERE event_id = 'pending-event' ORDER BY projection`,
        )
        .all(),
    ).toEqual(
      [
        "automation_enrollment",
        "campaign",
        "decision_wake",
        "grade",
        "scoring",
        "segment_reconcile",
      ].map((projection) => ({ projection, status: "pending" })),
    );
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM contact_event_projections WHERE event_id = 'processed-event'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const scoreEventForeignKeys = database
      .prepare("PRAGMA foreign_key_list('score_events')")
      .all() as Array<{ table: string; from: string; on_delete: string }>;
    expect(scoreEventForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "contact_events",
          from: "contact_event_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "scoring_rules",
          from: "scoring_rule_id",
          on_delete: "SET NULL",
        }),
      ]),
    );
    const touchForeignKeys = database
      .prepare("PRAGMA foreign_key_list('campaign_touches')")
      .all() as Array<{ table: string; from: string; on_delete: string }>;
    expect(touchForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "contact_events",
          from: "source_event_id",
          on_delete: "CASCADE",
        }),
      ]),
    );
  });
});

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}
