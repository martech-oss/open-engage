/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const migrationsBefore0014 = [
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
] as const;

describe("deal pipeline and project resource migration 0014", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("repairs zero, multiple, and archived defaults before enforcing uniqueness", () => {
    database = createPre0014Database(["zero", "multiple", "archived"]);
    database.exec(`
      INSERT INTO deal_pipelines
        (id, workspace_id, name, is_default, archived_at, created_at, updated_at)
      VALUES
        ('zero-b', 'zero', 'Zero B', 0, NULL, '2026-01-01', '2026-01-01'),
        ('zero-a', 'zero', 'Zero A', 0, NULL, '2026-01-01', '2026-01-01'),
        ('multiple-old-nondefault', 'multiple', 'Old nondefault', 0, NULL,
         '2025-01-01', '2025-01-01'),
        ('multiple-b', 'multiple', 'Multiple B', 1, NULL, '2026-01-01', '2026-01-01'),
        ('multiple-a', 'multiple', 'Multiple A', 1, NULL, '2026-01-01', '2026-01-01'),
        ('archived-default', 'archived', 'Archived default', 1, '2026-02-01',
         '2025-01-01', '2026-02-01'),
        ('archived-b', 'archived', 'Archived B', 0, NULL, '2026-01-01', '2026-01-01'),
        ('archived-a', 'archived', 'Archived A', 0, NULL, '2026-01-01', '2026-01-01');
    `);

    applyMigrations(database, ["0014_deep_logan.sql"]);

    expect(
      database
        .prepare(
          `SELECT workspace_id AS workspaceId, id, is_default AS isDefault
           FROM deal_pipelines ORDER BY workspace_id, id`,
        )
        .all(),
    ).toEqual([
      { workspaceId: "archived", id: "archived-a", isDefault: 1 },
      { workspaceId: "archived", id: "archived-b", isDefault: 0 },
      { workspaceId: "archived", id: "archived-default", isDefault: 0 },
      { workspaceId: "multiple", id: "multiple-a", isDefault: 1 },
      { workspaceId: "multiple", id: "multiple-b", isDefault: 0 },
      { workspaceId: "multiple", id: "multiple-old-nondefault", isDefault: 0 },
      { workspaceId: "zero", id: "zero-a", isDefault: 1 },
      { workspaceId: "zero", id: "zero-b", isDefault: 0 },
    ]);
    expect(() =>
      database!.exec(`
        INSERT INTO deal_pipelines
          (id, workspace_id, name, is_default, archived_at, created_at, updated_at)
        VALUES ('zero-second-default', 'zero', 'Second default', 1, NULL,
                '2026-02-01', '2026-02-01');
      `),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it("renames legacy email and page project links before tightening the check", () => {
    database = createPre0014Database(["workspace"]);
    database.exec(`
      INSERT INTO projects (id, workspace_id, name, created_at, updated_at)
      VALUES ('project', 'workspace', 'Campaign', '2026-01-01', '2026-01-01');
      INSERT INTO project_items
        (workspace_id, project_id, resource_type, resource_id, created_at)
      VALUES
        ('workspace', 'project', 'email', 'template', '2026-01-01'),
        ('workspace', 'project', 'page', 'landing-page', '2026-01-01'),
        ('workspace', 'project', 'redirect', 'redirect', '2026-01-01');
    `);

    applyMigrations(database, ["0014_deep_logan.sql"]);

    expect(
      database
        .prepare(
          "SELECT resource_type AS resourceType, resource_id AS resourceId FROM project_items ORDER BY resource_id",
        )
        .all(),
    ).toEqual([
      { resourceType: "landing_page", resourceId: "landing-page" },
      { resourceType: "redirect", resourceId: "redirect" },
      { resourceType: "email_sequence", resourceId: "template" },
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'project_items' ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "project_items_reject_locked_brief_delete" },
      { name: "project_items_validate_brief_link" },
      { name: "project_items_validate_brief_relink" },
    ]);
  });
});

function createPre0014Database(workspaceIds: string[]): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyMigrations(database, migrationsBefore0014);
  for (const workspaceId of workspaceIds) {
    database
      .prepare("INSERT INTO organization (id, name, slug, created_at) VALUES (?, ?, ?, 1)")
      .run(workspaceId, workspaceId, workspaceId);
  }
  return database;
}

function applyMigrations(database: DatabaseSync, files: readonly string[]): void {
  for (const file of files) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
}
