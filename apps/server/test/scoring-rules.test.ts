import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  ContactResourceRepository,
  createDatabase,
  ScoringRepository,
  uuidv7,
} from "@openengage/database/testing";

import { recordContactEvent } from "../src/runtime/contact-event-service";
import { seedWorkspace, seedWorkspaceClient } from "./factory";

interface Fixture {
  workspaceId: string;
  contactId: string;
  scoring: ScoringRepository;
}

async function seed(email: string, customFields: Record<string, unknown> = {}): Promise<Fixture> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "scoring-owner",
    role: "owner",
  }).createContact({ email, customFields });
  return {
    workspaceId,
    contactId: contact.id,
    scoring: new ScoringRepository(env.DB, { workspaceId }),
  };
}

async function readContact(id: string): Promise<{ score: number; grade_points: number }> {
  const row = await env.DB.prepare("SELECT score, grade_points FROM contacts WHERE id = ?")
    .bind(id)
    .first<{ score: number; grade_points: number }>();
  return row ?? { score: 0, grade_points: 0 };
}

async function countRows(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Recreates the pre-0009 table shape so the repository's defense-in-depth
 * workspace joins are exercised against legacy cross-workspace references.
 */
async function restoreLegacyScoringRulesTable(): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE legacy_scoring_rules (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      name text NOT NULL,
      event_type text NOT NULL,
      match_type text DEFAULT 'any' NOT NULL,
      match_value text,
      points integer DEFAULT 0 NOT NULL,
      category_id text,
      tag_id text,
      enabled integer DEFAULT true NOT NULL,
      archived_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES organization(id) ON DELETE cascade,
      FOREIGN KEY (category_id) REFERENCES scoring_categories(id) ON DELETE set null,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE set null
    )`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO legacy_scoring_rules
      (id, workspace_id, name, event_type, match_type, match_value, points,
       category_id, tag_id, enabled, archived_at, created_at, updated_at)
     SELECT id, workspace_id, name, event_type, match_type, match_value, points,
            category_id, tag_id, enabled, archived_at, created_at, updated_at
     FROM scoring_rules`,
  ).run();
  await env.DB.prepare("DROP TABLE scoring_rules").run();
  await env.DB.prepare("ALTER TABLE legacy_scoring_rules RENAME TO scoring_rules").run();
  await env.DB.prepare(
    `CREATE INDEX scoring_rules_workspace_event_idx
     ON scoring_rules (workspace_id, event_type, enabled)`,
  ).run();
}

async function insertLegacyRule(input: {
  workspaceId: string;
  categoryId: string | null;
  tagId: string | null;
  points: number;
}): Promise<string> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO scoring_rules
      (id, workspace_id, name, event_type, match_type, match_value, points,
       category_id, tag_id, enabled, created_at, updated_at)
     VALUES (?, ?, 'legacy rule', 'page_viewed', 'any', NULL, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, input.workspaceId, input.points, input.categoryId, input.tagId, now, now)
    .run();
  return id;
}

function emit(
  fixture: Fixture,
  type: string,
  resourceId: string | null,
  properties: Record<string, unknown> = {},
) {
  return recordContactEvent(createDatabase(env.DB), {
    workspaceId: fixture.workspaceId,
    contactId: fixture.contactId,
    type,
    resourceId,
    properties,
  });
}

async function expectNoScoringSideEffects(fixture: Fixture): Promise<void> {
  await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 0 });
  await expect(
    countRows("SELECT COUNT(*) AS count FROM score_events WHERE contact_id = ?", fixture.contactId),
  ).resolves.toBe(0);
  await expect(
    countRows(
      "SELECT COUNT(*) AS count FROM contact_category_scores WHERE contact_id = ?",
      fixture.contactId,
    ),
  ).resolves.toBe(0);
  await expect(
    countRows("SELECT COUNT(*) AS count FROM contact_tags WHERE contact_id = ?", fixture.contactId),
  ).resolves.toBe(0);
}

describe("scoring rules", () => {
  it("returns the same not-found error for foreign references on create and update", async () => {
    const local = await seedWorkspaceClient(env.DB);
    const foreign = await seedWorkspaceClient(env.DB);
    const localScoring = new ScoringRepository(env.DB, { workspaceId: local.workspaceId });
    const foreignCategory = await new ScoringRepository(env.DB, {
      workspaceId: foreign.workspaceId,
    }).createCategory({ name: "Foreign API category", slug: "foreign-api-category" });
    const created = await local.client.scoring.createRule({
      name: "Local API rule",
      eventType: "page_viewed",
      matchType: "any",
      matchValue: null,
      points: 5,
      categoryId: null,
      tagId: null,
      enabled: true,
    });
    expect(created.id).toBeTruthy();
    const foreignInput = {
      name: "Foreign reference",
      eventType: "page_viewed" as const,
      matchType: "any" as const,
      matchValue: null,
      points: 5,
      categoryId: foreignCategory.id,
      tagId: null,
      enabled: true,
    };

    await expect(local.client.scoring.createRule(foreignInput)).rejects.toMatchObject({
      code: "SCORING_RULE_NOT_FOUND",
      status: 404,
    });
    await expect(
      local.client.scoring.updateRule({ id: created.id, ...foreignInput }),
    ).rejects.toMatchObject({ code: "SCORING_RULE_NOT_FOUND", status: 404 });
    await expect(localScoring.listRules()).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: "Local API rule", categoryId: null }),
    ]);
  });

  it("rejects foreign, missing, and archived rule references without writing a rule", async () => {
    const local = await seed("tenant-safe-create@example.com");
    const foreign = await seed("foreign-create@example.com");
    const foreignCategory = await foreign.scoring.createCategory({
      name: "Foreign category",
      slug: "foreign-category",
    });
    const archivedCategory = await local.scoring.createCategory({
      name: "Archived category",
      slug: "archived-category",
    });
    await local.scoring.archiveCategory(archivedCategory.id);
    const foreignTagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: foreign.workspaceId }).createTag({
      id: foreignTagId,
      name: "Foreign tag",
      slug: "foreign-tag",
      color: "#64748b",
    });
    const base = {
      name: "Tenant-safe rule",
      eventType: "page_viewed" as const,
      matchType: "any" as const,
      matchValue: null,
      points: 10,
      tagId: null,
      enabled: true,
    };

    await expect(
      local.scoring.createRule({ ...base, categoryId: foreignCategory.id }),
    ).resolves.toBeNull();
    await expect(
      local.scoring.createRule({ ...base, categoryId: "missing-category" }),
    ).resolves.toBeNull();
    await expect(
      local.scoring.createRule({ ...base, categoryId: archivedCategory.id }),
    ).resolves.toBeNull();
    await expect(
      local.scoring.createRule({ ...base, categoryId: null, tagId: foreignTagId }),
    ).resolves.toBeNull();
    await expect(
      local.scoring.createRule({ ...base, categoryId: null, tagId: "missing-tag" }),
    ).resolves.toBeNull();
    await expect(local.scoring.listRules()).resolves.toEqual([]);
  });

  it("rejects foreign or archived references on update and preserves the existing rule", async () => {
    const local = await seed("tenant-safe-update@example.com");
    const foreign = await seed("foreign-update@example.com");
    const localCategory = await local.scoring.createCategory({
      name: "Local category",
      slug: "local-category",
    });
    const foreignCategory = await foreign.scoring.createCategory({
      name: "Foreign category",
      slug: "foreign-update-category",
    });
    const archivedCategory = await local.scoring.createCategory({
      name: "Archived category",
      slug: "archived-update-category",
    });
    await local.scoring.archiveCategory(archivedCategory.id);
    const foreignTagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: foreign.workspaceId }).createTag({
      id: foreignTagId,
      name: "Foreign update tag",
      slug: "foreign-update-tag",
      color: "#64748b",
    });
    const created = await local.scoring.createRule({
      name: "Original rule",
      eventType: "page_viewed",
      matchType: "any",
      matchValue: null,
      points: 4,
      categoryId: localCategory.id,
      tagId: null,
      enabled: true,
    });
    expect(created).not.toBeNull();
    if (!created) throw new Error("Expected the local scoring rule to be created");
    const changed = {
      name: "Changed rule",
      eventType: "page_viewed" as const,
      matchType: "any" as const,
      matchValue: null,
      points: 99,
      tagId: null,
      enabled: true,
    };

    await expect(
      local.scoring.updateRule(created.id, { ...changed, categoryId: foreignCategory.id }),
    ).resolves.toBe(false);
    await expect(
      local.scoring.updateRule(created.id, { ...changed, categoryId: archivedCategory.id }),
    ).resolves.toBe(false);
    await expect(
      local.scoring.updateRule(created.id, {
        ...changed,
        categoryId: null,
        tagId: foreignTagId,
      }),
    ).resolves.toBe(false);
    await expect(local.scoring.listRules()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Original rule",
        points: 4,
        categoryId: localCategory.id,
        categoryName: "Local category",
      }),
    ]);
  });

  it("does not leak foreign category or tag names from a legacy rule", async () => {
    const local = await seed("foreign-list-local@example.com");
    const foreign = await seed("foreign-list-owner@example.com");
    const foreignCategory = await foreign.scoring.createCategory({
      name: "Foreign category secret",
      slug: "foreign-category-secret",
    });
    const foreignTagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: foreign.workspaceId }).createTag({
      id: foreignTagId,
      name: "Foreign tag secret",
      slug: "foreign-tag-secret",
      color: "#64748b",
    });
    await restoreLegacyScoringRulesTable();
    await insertLegacyRule({
      workspaceId: local.workspaceId,
      categoryId: foreignCategory.id,
      tagId: foreignTagId,
      points: 10,
    });

    await expect(local.scoring.listRules()).resolves.toEqual([
      expect.objectContaining({
        categoryId: null,
        categoryName: null,
        tagId: null,
        tagName: null,
      }),
    ]);
  });

  it("does not score or attach a foreign category from a legacy rule", async () => {
    const local = await seed("foreign-category-execution-local@example.com");
    const foreign = await seed("foreign-category-execution-owner@example.com");
    const foreignCategory = await foreign.scoring.createCategory({
      name: "Foreign execution category",
      slug: "foreign-execution-category",
    });
    await restoreLegacyScoringRulesTable();
    await insertLegacyRule({
      workspaceId: local.workspaceId,
      categoryId: foreignCategory.id,
      tagId: null,
      points: 10,
    });

    await expect(emit(local, "page_viewed", "https://example.com/")).resolves.toMatchObject({
      enrollmentCount: 0,
    });
    await expectNoScoringSideEffects(local);
  });

  it("does not score or attach a foreign tag from a legacy rule", async () => {
    const local = await seed("foreign-tag-execution-local@example.com");
    const foreign = await seed("foreign-tag-execution-owner@example.com");
    const foreignTagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: foreign.workspaceId }).createTag({
      id: foreignTagId,
      name: "Foreign execution tag",
      slug: "foreign-execution-tag",
      color: "#64748b",
    });
    await restoreLegacyScoringRulesTable();
    await insertLegacyRule({
      workspaceId: local.workspaceId,
      categoryId: null,
      tagId: foreignTagId,
      points: 10,
    });

    await expect(emit(local, "page_viewed", "https://example.com/")).resolves.toMatchObject({
      enrollmentCount: 0,
    });
    await expectNoScoringSideEffects(local);
  });

  it("does not expose an archived category from a legacy malformed rule", async () => {
    const local = await seed("tenant-safe-list@example.com");
    const category = await local.scoring.createCategory({
      name: "Archived category",
      slug: "archived-list-category",
    });
    await local.scoring.archiveCategory(category.id);
    const tagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: local.workspaceId }).createTag({
      id: tagId,
      name: "Local tag",
      slug: "local-list-tag",
      color: "#64748b",
    });
    await insertLegacyRule({
      workspaceId: local.workspaceId,
      categoryId: category.id,
      tagId,
      points: 10,
    });

    await expect(local.scoring.listRules()).resolves.toEqual([
      expect.objectContaining({
        categoryId: null,
        categoryName: null,
        tagId,
        tagName: "Local tag",
      }),
    ]);
  });

  it("does not execute a legacy rule that references an archived category", async () => {
    const local = await seed("tenant-safe-execution@example.com");
    const category = await local.scoring.createCategory({
      name: "Archived execution category",
      slug: "archived-execution-category",
    });
    await local.scoring.archiveCategory(category.id);
    const tagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId: local.workspaceId }).createTag({
      id: tagId,
      name: "Local execution tag",
      slug: "local-execution-tag",
      color: "#64748b",
    });
    await insertLegacyRule({
      workspaceId: local.workspaceId,
      categoryId: category.id,
      tagId,
      points: 10,
    });

    await emit(local, "page_viewed", "https://example.com/");

    await expect(readContact(local.contactId)).resolves.toMatchObject({ score: 0 });
    await expect(
      countRows("SELECT COUNT(*) AS count FROM score_events WHERE contact_id = ?", local.contactId),
    ).resolves.toBe(0);
    await expect(
      countRows(
        "SELECT COUNT(*) AS count FROM contact_category_scores WHERE contact_id = ?",
        local.contactId,
      ),
    ).resolves.toBe(0);
    await expect(
      countRows("SELECT COUNT(*) AS count FROM contact_tags WHERE contact_id = ?", local.contactId),
    ).resolves.toBe(0);
  });
});
