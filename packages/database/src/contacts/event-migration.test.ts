/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { processPendingPublicFormEvent } from "../../../../apps/server/src/contacts/event-service";
import { OpenEngageDatabase } from "../client";

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

  it("quarantines all six projections for unfinished legacy outbox work", () => {
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
      ].map((projection) => ({ projection, status: "skipped" })),
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

  it("does not replay legacy score and campaign effects when the outbox retries", async () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationFiles.slice(0, 12));
    database.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('workspace', 'Workspace', 'workspace', 1);
      INSERT INTO contacts
        (id, workspace_id, status, score, created_at, updated_at)
      VALUES ('contact', 'workspace', 'active', 5, '2026-01-01', '2026-01-01');
      INSERT INTO scoring_categories
        (id, workspace_id, name, slug, created_at, updated_at)
      VALUES ('category', 'workspace', 'Intent', 'intent', '2026-01-01', '2026-01-01');
      INSERT INTO scoring_rules
        (id, workspace_id, name, event_type, points, category_id, created_at, updated_at)
      VALUES (
        'rule', 'workspace', 'Form score', 'form_submitted', 5, 'category',
        '2026-01-01', '2026-01-01'
      );
      INSERT INTO contact_category_scores
        (workspace_id, contact_id, category_id, score, updated_at)
      VALUES ('workspace', 'contact', 'category', 5, '2026-01-01');
      INSERT INTO score_events
        (id, workspace_id, contact_id, delta, reason, created_at)
      VALUES ('legacy-score', 'workspace', 'contact', 5, 'rule:rule', '2026-01-01');
      INSERT INTO projects
        (id, workspace_id, name, created_at, updated_at)
      VALUES ('project', 'workspace', 'Campaign', '2026-01-01', '2026-01-01');
      INSERT INTO project_items
        (workspace_id, project_id, resource_type, resource_id, created_at)
      VALUES ('workspace', 'project', 'form', 'form', '2026-01-01');
      INSERT INTO campaign_touches
        (id, workspace_id, project_id, contact_id, resource_type, resource_id,
         event_type, occurred_at, created_at)
      VALUES (
        'legacy-touch', 'workspace', 'project', 'contact', 'form', 'form',
        'form_submitted', '2026-01-01', '2026-01-01'
      );
      INSERT INTO contact_events
        (id, workspace_id, contact_id, type, resource_type, resource_id,
         properties, occurred_at, created_at)
      VALUES (
        'legacy-event', 'workspace', 'contact', 'form_submitted', 'form', 'form',
        '{}', '2026-01-01', '2026-01-01'
      );
      INSERT INTO contact_event_outbox
        (event_id, workspace_id, status, created_at)
      VALUES ('legacy-event', 'workspace', 'pending', '2026-01-01');
    `);

    applyMigrations(database, migrationFiles.slice(12));
    await processPendingPublicFormEvent(
      new OpenEngageDatabase(createSqliteD1Binding(database)),
      "legacy-event",
    );

    expect(database.prepare("SELECT score FROM contacts WHERE id = 'contact'").get()).toEqual({
      score: 5,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM score_events").get()).toEqual({
      count: 1,
    });
    expect(
      database
        .prepare(
          `SELECT score FROM contact_category_scores
           WHERE contact_id = 'contact' AND category_id = 'category'`,
        )
        .get(),
    ).toEqual({ score: 5 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM campaign_touches").get()).toEqual({
      count: 1,
    });
    expect(
      database
        .prepare("SELECT status, processed_at FROM contact_event_outbox WHERE event_id = ?")
        .get("legacy-event"),
    ).toEqual({ status: "processed", processed_at: expect.any(String) });
  });
});

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}

interface SqliteBoundStatement {
  execute(): D1Result;
}

function createSqliteD1Binding(database: DatabaseSync): D1Database {
  const prepare = (query: string): D1PreparedStatement => {
    const bind = (...params: unknown[]): D1PreparedStatement => {
      const execute = (): D1Result => {
        const statement = database.prepare(query);
        const columns = statement.columns();
        const sqliteParams = params as SQLInputValue[];
        const before = database.prepare("SELECT total_changes() AS count").get() as {
          count: number;
        };
        const results =
          columns.length === 0
            ? (statement.run(...sqliteParams), [])
            : (statement.all(...sqliteParams) as Record<string, unknown>[]);
        const after = database.prepare("SELECT total_changes() AS count").get() as {
          count: number;
        };
        return {
          success: true,
          results,
          meta: { changes: after.count - before.count },
        } as D1Result;
      };
      const bound = {
        bind,
        all: async () => execute(),
        first: async (column?: string) => {
          const row = execute().results[0] as Record<string, unknown> | undefined;
          return column ? (row?.[column] ?? null) : (row ?? null);
        },
        raw: async () => {
          const result = execute();
          const columns = database
            .prepare(query)
            .columns()
            .map((column) => column.name);
          return result.results.map((row) => {
            const record = row as Record<string, unknown>;
            return columns.map((column) => record[column]);
          });
        },
        run: async () => execute(),
        execute,
      } satisfies SqliteBoundStatement & Record<string, unknown>;
      return bound as unknown as D1PreparedStatement;
    };
    return bind();
  };

  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          (statement as unknown as SqliteBoundStatement).execute(),
        );
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
