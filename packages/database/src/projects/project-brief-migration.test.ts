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
] as const;

describe("project brief migration 0004", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("upgrades a 0003 fixture and enforces the new invariants", () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationFiles.slice(0, 4));
    seedLegacyFixture(database);

    applyMigrations(database, migrationFiles.slice(4));

    expect(
      database
        .prepare(
          `SELECT status, revision, row_version AS rowVersion, definition
           FROM project_briefs
           WHERE workspace_id = ? AND project_id = ?`,
        )
        .get("workspace-a", "project-a"),
    ).toEqual({
      status: "approved",
      revision: 2,
      rowVersion: 1,
      definition: '{"outcome":"legacy approved brief"}',
    });
    expect(
      database
        .prepare(
          `SELECT revision, name, owner_user_id AS ownerUserId,
                  approver_user_id AS approverUserId, definition
           FROM project_brief_versions
           WHERE workspace_id = ? AND project_id = ?`,
        )
        .get("workspace-a", "project-a"),
    ).toEqual({
      revision: 2,
      name: "Legacy campaign",
      ownerUserId: "owner-a",
      approverUserId: "approver-a",
      definition: '{"outcome":"legacy approved brief"}',
    });
    expect(
      database
        .prepare(
          `SELECT brief_revision AS briefRevision, added_by_user_id AS addedByUserId
           FROM project_items
           WHERE workspace_id = ? AND project_id = ? AND resource_id = ?`,
        )
        .get("workspace-a", "project-a", "legacy-segment"),
    ).toEqual({ briefRevision: 2, addedByUserId: "owner-a" });

    database.prepare("DELETE FROM user WHERE id = ?").run("linker-a");
    expect(
      database
        .prepare(
          `SELECT added_by_user_id AS addedByUserId
           FROM project_items
           WHERE workspace_id = ? AND project_id = ? AND resource_id = ?`,
        )
        .get("workspace-a", "project-a", "legacy-form"),
    ).toEqual({ addedByUserId: null });

    expect(() =>
      database!
        .prepare(
          `INSERT INTO project_items (
             workspace_id, project_id, resource_type, resource_id, brief_revision,
             added_by_user_id, created_at
           ) VALUES (?, ?, 'segment', 'cross-tenant', NULL, NULL, ?)`,
        )
        .run("workspace-a", "project-b", "2026-01-01T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      database!
        .prepare(
          `UPDATE project_briefs SET definition = 'not-json'
           WHERE workspace_id = ? AND project_id = ?`,
        )
        .run("workspace-a", "project-a"),
    ).toThrow(/CHECK constraint failed/);

    database.prepare("DELETE FROM organization WHERE id = ?").run("workspace-a");
    for (const table of ["projects", "project_briefs", "project_brief_versions", "project_items"]) {
      expect(
        database
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
          .get("workspace-a"),
      ).toEqual({ count: 0 });
    }
  });
});

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}

function seedLegacyFixture(database: DatabaseSync): void {
  const createdAt = "2026-01-01T00:00:00.000Z";
  database.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('workspace-a', 'Workspace A', 'workspace-a', 1),
           ('workspace-b', 'Workspace B', 'workspace-b', 1);
    INSERT INTO user (id, name, email, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'owner-a@example.test', 1, 1),
           ('approver-a', 'Approver A', 'approver-a@example.test', 1, 1),
           ('linker-a', 'Linker A', 'linker-a@example.test', 1, 1);
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES ('member-owner-a', 'workspace-a', 'owner-a', 'marketer', 1),
           ('member-approver-a', 'workspace-a', 'approver-a', 'marketer', 1),
           ('member-linker-a', 'workspace-a', 'linker-a', 'admin', 1);
    INSERT INTO projects (id, workspace_id, name, description, color, created_at, updated_at)
    VALUES ('project-a', 'workspace-a', 'Legacy campaign', 'Existing project', '#7c3aed', '${createdAt}', '${createdAt}'),
           ('project-b', 'workspace-b', 'Other tenant project', '', '#7c3aed', '${createdAt}', '${createdAt}');
    INSERT INTO project_briefs (
      project_id, workspace_id, status, revision, owner_user_id, approver_user_id,
      primary_motion, review_at, definition, submitted_at, approved_at,
      approved_by_user_id, created_at, updated_at
    ) VALUES (
      'project-a', 'workspace-a', 'approved', 2, 'owner-a', 'approver-a',
      'onboarding', '2026-02-01T00:00:00.000Z', '{"outcome":"legacy approved brief"}',
      '${createdAt}', '${createdAt}', 'approver-a', '${createdAt}', '${createdAt}'
    );
    INSERT INTO project_items (
      workspace_id, project_id, resource_type, resource_id, created_at,
      brief_revision, added_by_user_id
    ) VALUES (
      'workspace-a', 'project-a', 'segment', 'legacy-segment', '${createdAt}', 2, 'owner-a'
    ), (
      'workspace-a', 'project-a', 'form', 'legacy-form', '${createdAt}', 2, 'linker-a'
    );
  `);
}
