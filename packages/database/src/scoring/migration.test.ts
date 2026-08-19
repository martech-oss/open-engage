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
] as const;

describe("tenant-safe scoring migration 0009", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("cleans legacy cross-workspace references and enforces composite ownership", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationFiles.slice(0, 9));
    seedLegacyFixture(database);

    applyMigrations(database, migrationFiles.slice(9));

    expect(
      database
        .prepare(
          `SELECT id, category_id AS categoryId, tag_id AS tagId, enabled
           FROM scoring_rules WHERE workspace_id = 'workspace-a' ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "archived-category-rule", categoryId: null, tagId: null, enabled: 0 },
      { id: "cross-workspace-rule", categoryId: null, tagId: null, enabled: 0 },
    ]);
    expect(count(database, "contact_tags")).toBe(0);
    expect(count(database, "contact_category_scores")).toBe(0);
    expect(count(database, "score_events")).toBe(0);
    expect(
      database
        .prepare("SELECT contact_id AS contactId FROM contact_events WHERE id = 'audit-event'")
        .get(),
    ).toEqual({ contactId: null });

    expect(() =>
      database!
        .prepare(
          `INSERT INTO scoring_rules
            (id, workspace_id, name, event_type, match_type, points, category_id,
             enabled, created_at, updated_at)
           VALUES ('blocked-rule', 'workspace-a', 'Blocked', 'page_viewed', 'any', 1,
                   'category-b', 1, '2026-01-01', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      database!
        .prepare(
          `INSERT INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
           VALUES ('workspace-a', 'contact-a', 'tag-b', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);

    database.exec(`
      INSERT INTO contact_events
        (id, workspace_id, contact_id, type, properties, occurred_at, created_at)
      VALUES ('valid-audit-event', 'workspace-a', 'contact-a', 'page_viewed', '{}',
              '2026-01-01', '2026-01-01');
      INSERT INTO tags (id, workspace_id, name, slug, created_at)
      VALUES ('tag-a', 'workspace-a', 'Tag A', 'tag-a', '2026-01-01');
      INSERT INTO scoring_categories
        (id, workspace_id, name, slug, created_at, updated_at)
      VALUES ('category-a', 'workspace-a', 'Category A', 'category-a', '2026-01-01', '2026-01-01');
      INSERT INTO scoring_rules
        (id, workspace_id, name, event_type, match_type, points, category_id, tag_id,
         enabled, created_at, updated_at)
      VALUES ('valid-rule', 'workspace-a', 'Valid', 'page_viewed', 'any', 1,
              'category-a', 'tag-a', 1, '2026-01-01', '2026-01-01');
      DELETE FROM tags WHERE id = 'tag-a';
      DELETE FROM scoring_categories WHERE id = 'category-a';
      DELETE FROM contacts WHERE id = 'contact-a';
    `);
    expect(
      database
        .prepare(
          "SELECT category_id AS categoryId, tag_id AS tagId FROM scoring_rules WHERE id = 'valid-rule'",
        )
        .get(),
    ).toEqual({ categoryId: null, tagId: null });
    expect(
      database
        .prepare(
          "SELECT contact_id AS contactId FROM contact_events WHERE id = 'valid-audit-event'",
        )
        .get(),
    ).toEqual({ contactId: null });
  });
});

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

function seedLegacyFixture(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('workspace-a', 'Workspace A', 'workspace-a', 1),
           ('workspace-b', 'Workspace B', 'workspace-b', 1);
    INSERT INTO contacts (id, workspace_id, email, status, custom_fields, created_at, updated_at)
    VALUES ('contact-a', 'workspace-a', 'a@example.test', 'active', '{}', '2026-01-01', '2026-01-01'),
           ('contact-b', 'workspace-b', 'b@example.test', 'active', '{}', '2026-01-01', '2026-01-01');
    INSERT INTO tags (id, workspace_id, name, slug, created_at)
    VALUES ('tag-b', 'workspace-b', 'Tag B', 'tag-b', '2026-01-01');
    INSERT INTO scoring_categories
      (id, workspace_id, name, slug, archived_at, created_at, updated_at)
    VALUES ('category-a-archived', 'workspace-a', 'Archived', 'archived', '2026-01-01', '2026-01-01', '2026-01-01'),
           ('category-b', 'workspace-b', 'Category B', 'category-b', NULL, '2026-01-01', '2026-01-01');
    INSERT INTO scoring_rules
      (id, workspace_id, name, event_type, match_type, points, category_id, tag_id,
       enabled, created_at, updated_at)
    VALUES ('archived-category-rule', 'workspace-a', 'Archived category', 'page_viewed', 'any', 1,
            'category-a-archived', NULL, 1, '2026-01-01', '2026-01-01'),
           ('cross-workspace-rule', 'workspace-a', 'Cross workspace', 'page_viewed', 'any', 1,
            'category-b', 'tag-b', 1, '2026-01-01', '2026-01-01');
    INSERT INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
    VALUES ('workspace-a', 'contact-a', 'tag-b', '2026-01-01');
    INSERT INTO contact_category_scores (workspace_id, contact_id, category_id, score, updated_at)
    VALUES ('workspace-a', 'contact-a', 'category-b', 4, '2026-01-01');
    INSERT INTO score_events (id, workspace_id, contact_id, delta, reason, created_at)
    VALUES ('cross-score', 'workspace-a', 'contact-b', 4, 'legacy', '2026-01-01');
    INSERT INTO contact_events
      (id, workspace_id, contact_id, type, properties, occurred_at, created_at)
    VALUES ('audit-event', 'workspace-a', 'contact-b', 'page_viewed', '{}', '2026-01-01', '2026-01-01');
  `);
  database.exec("PRAGMA foreign_keys = ON");
}
