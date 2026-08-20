/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AutomationActionRepository } from "./action-repository";
import { AutomationJobRecoveryRepository } from "./job-recovery-repository";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const migrationsBefore0015 = [
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
  "0013_omniscient_jasper_sitwell.sql",
  "0014_deep_logan.sql",
] as const;

describe("legacy automation action quarantine migration 0015", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("terminalizes ambiguous leased and running actions so a committed score cannot replay", async () => {
    database = createPre0015Database();
    seedLegacyAutomationActions(database);

    applyMigrations(database, ["0015_quarantine_legacy_automation_actions.sql"]);

    expect(
      database
        .prepare(
          `SELECT id, status, lease_id AS leaseId, lease_until AS leaseUntil,
                  wait_event_type AS waitEventType, wait_resource_id AS waitResourceId,
                  last_error AS lastError
           FROM automation_jobs ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "legacy-leased-job",
        status: "failed",
        leaseId: null,
        leaseUntil: null,
        waitEventType: null,
        waitResourceId: null,
        lastError: "legacy_outcome_unknown",
      },
      {
        id: "legacy-running-job",
        status: "failed",
        leaseId: null,
        leaseUntil: null,
        waitEventType: null,
        waitResourceId: null,
        lastError: "legacy_outcome_unknown",
      },
      {
        id: "pending-job",
        status: "pending",
        leaseId: null,
        leaseUntil: null,
        waitEventType: null,
        waitResourceId: null,
        lastError: null,
      },
      {
        id: "succeeded-job",
        status: "succeeded",
        leaseId: null,
        leaseUntil: null,
        waitEventType: null,
        waitResourceId: null,
        lastError: null,
      },
    ]);
    expect(
      database
        .prepare(
          `SELECT id, status, current_node_id AS currentNodeId,
                  completed_at IS NOT NULL AS completed
           FROM automation_enrollments ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "legacy-leased", status: "failed", currentNodeId: null, completed: 1 },
      { id: "legacy-running", status: "failed", currentNodeId: null, completed: 1 },
      { id: "pending", status: "active", currentNodeId: "pending-node", completed: 0 },
      { id: "succeeded", status: "completed", currentNodeId: null, completed: 1 },
    ]);

    const binding = createSqliteD1Binding(database);
    await new AutomationActionRepository(binding).adjustContactScoreForJob(
      {
        id: "legacy-running-job",
        workspaceId: "workspace",
        contactId: "contact",
        enrollmentId: "legacy-running",
        nodeId: "change-score",
      },
      "legacy-running-lease",
      5,
      "2030-01-01T00:00:00.000Z",
    );
    await new AutomationJobRecoveryRepository(binding).recoverExpiredJobs(
      "2030-01-01T00:00:00.000Z",
    );

    expect(database.prepare("SELECT score FROM contacts WHERE id = 'contact'").get()).toEqual({
      score: 5,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM score_events").get()).toEqual({
      count: 1,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM automation_action_effects").get(),
    ).toEqual({ count: 0 });
  });
});

function createPre0015Database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyMigrations(database, migrationsBefore0015);
  return database;
}

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}

function seedLegacyAutomationActions(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('workspace', 'Workspace', 'workspace', 1);
    INSERT INTO contacts
      (id, workspace_id, email, score, status, custom_fields, created_at, updated_at)
    VALUES
      ('contact', 'workspace', 'legacy@example.com', 5, 'active', '{}',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO automations
      (id, workspace_id, name, status, created_at, updated_at)
    VALUES
      ('automation', 'workspace', 'Legacy automation', 'active',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO automation_versions
      (id, workspace_id, automation_id, version, status, graph, published_at, created_at)
    VALUES
      ('version', 'workspace', 'automation', 1, 'published',
       '{"nodes":[],"edges":[]}', '2026-01-01T00:00:00.000Z',
       '2026-01-01T00:00:00.000Z');
    INSERT INTO automation_enrollments
      (id, workspace_id, automation_id, automation_version_id, contact_id, status,
       current_node_id, entered_at, completed_at, updated_at)
    VALUES
      ('legacy-running', 'workspace', 'automation', 'version', 'contact', 'active',
       'change-score', '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z'),
      ('legacy-leased', 'workspace', 'automation', 'version', 'contact', 'active',
       'leased-node', '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z'),
      ('pending', 'workspace', 'automation', 'version', 'contact', 'active',
       'pending-node', '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z'),
      ('succeeded', 'workspace', 'automation', 'version', 'contact', 'completed',
       NULL, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
       '2026-01-02T00:00:00.000Z');
    INSERT INTO automation_jobs
      (id, workspace_id, enrollment_id, automation_version_id, node_id, contact_id,
       idempotency_key, status, due_at, lease_id, lease_until, wait_event_type,
       wait_resource_id, attempts, created_at, updated_at)
    VALUES
      ('legacy-running-job', 'workspace', 'legacy-running', 'version', 'change-score',
       'contact', 'legacy-running-key', 'running', '2026-01-01T00:00:00.000Z',
       'legacy-running-lease', '2026-01-01T00:01:00.000Z', 'custom_event', 'resource', 5,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('legacy-leased-job', 'workspace', 'legacy-leased', 'version', 'leased-node',
       'contact', 'legacy-leased-key', 'leased', '2026-01-01T00:00:00.000Z',
       'legacy-leased-lease', '2026-01-01T00:01:00.000Z', NULL, NULL, 1,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('pending-job', 'workspace', 'pending', 'version', 'pending-node', 'contact',
       'pending-key', 'pending', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, 0,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('succeeded-job', 'workspace', 'succeeded', 'version', 'succeeded-node', 'contact',
       'succeeded-key', 'succeeded', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, 1,
       '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO score_events
      (id, workspace_id, contact_id, delta, reason, automation_enrollment_id, created_at)
    VALUES
      ('legacy-score-event', 'workspace', 'contact', 5, 'automation',
       'legacy-running', '2026-01-01T00:00:00.000Z');
  `);
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
