import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { gradeLetter } from "@openengage/core/scoring";
import {
  ContactRepository,
  ContactResourceRepository,
  createDatabase,
  ScoringRepository,
  uuidv7,
} from "@openengage/database";

import { recordContactEvent } from "../src/contacts/event-service";
import { recomputeContactGrade } from "../src/scoring/engine";
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

  it("does not score or attach foreign category and tag resources from a legacy rule", async () => {
    const local = await seed("foreign-execution-local@example.com");
    const foreign = await seed("foreign-execution-owner@example.com");
    const foreignCategory = await foreign.scoring.createCategory({
      name: "Foreign execution category",
      slug: "foreign-execution-category",
    });
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
      categoryId: foreignCategory.id,
      tagId: foreignTagId,
      points: 10,
    });

    await expect(emit(local, "page_viewed", "https://example.com/")).resolves.toMatchObject({
      enrollmentCount: 0,
    });
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

  it("adds points when a page view matches the URL rule (Page Action)", async () => {
    const fixture = await seed("page@example.com");
    await fixture.scoring.createRule({
      name: "料金ページ",
      eventType: "page_viewed",
      matchType: "url_contains",
      matchValue: "/pricing",
      points: 20,
      categoryId: null,
      tagId: null,
      enabled: true,
    });

    await emit(fixture, "page_viewed", "https://example.com/pricing");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 20 });

    // A different page must not trip the same rule.
    await emit(fixture, "page_viewed", "https://example.com/blog");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 20 });
  });

  it("ignores rules for another event type and disabled rules", async () => {
    const fixture = await seed("other@example.com");
    await fixture.scoring.createRule({
      name: "開封",
      eventType: "email_opened",
      matchType: "any",
      matchValue: null,
      points: 5,
      categoryId: null,
      tagId: null,
      enabled: true,
    });
    await fixture.scoring.createRule({
      name: "停止中のページ閲覧",
      eventType: "page_viewed",
      matchType: "any",
      matchValue: null,
      points: 99,
      categoryId: null,
      tagId: null,
      enabled: false,
    });

    await emit(fixture, "page_viewed", "https://example.com/");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 0 });

    await emit(fixture, "email_opened", "delivery-1");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 5 });
  });

  it("splits points into a category while still moving the overall score", async () => {
    const fixture = await seed("category@example.com");
    const category = await fixture.scoring.createCategory({ name: "製品A", slug: "product-a" });
    await fixture.scoring.createRule({
      name: "製品Aの資料",
      eventType: "custom_redirect_clicked",
      matchType: "any",
      matchValue: null,
      points: 15,
      categoryId: category.id,
      tagId: null,
      enabled: true,
    });

    await emit(fixture, "custom_redirect_clicked", "redirect-1");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: 15 });
    const row = await env.DB.prepare(
      "SELECT score FROM contact_category_scores WHERE contact_id = ? AND category_id = ?",
    )
      .bind(fixture.contactId, category.id)
      .first<{ score: number }>();
    expect(row?.score).toBe(15);
  });

  it("applies negative points and records one score event per rule", async () => {
    const fixture = await seed("negative@example.com");
    await fixture.scoring.createRule({
      name: "解約ページ",
      eventType: "page_viewed",
      matchType: "url_starts_with",
      matchValue: "https://example.com/cancel",
      points: -10,
      categoryId: null,
      tagId: null,
      enabled: true,
    });

    await emit(fixture, "page_viewed", "https://example.com/cancel/confirm");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ score: -10 });
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM score_events WHERE contact_id = ?",
    )
      .bind(fixture.contactId)
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
  });
});

describe("archived contact events", () => {
  it("keeps the audit event without scoring, grading, tagging, enrollment, or reconciliation", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "archived-tracking@example.com",
      customFields: { tier: "enterprise" },
    });
    const scoring = new ScoringRepository(env.DB, { workspaceId });
    const category = await scoring.createCategory({ name: "Product", slug: "product" });
    const tagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId }).createTag({
      id: tagId,
      name: "Engaged",
      slug: "engaged",
      color: "#64748b",
    });
    await scoring.createRule({
      name: "Tracked event",
      eventType: "custom_event",
      matchType: "any",
      matchValue: null,
      points: 25,
      categoryId: category.id,
      tagId,
      enabled: true,
    });
    await scoring.createCriterion({
      name: "Enterprise",
      field: "custom_field",
      fieldKey: "tier",
      operator: "eq",
      value: "enterprise",
      steps: 6,
      enabled: true,
    });
    const automation = await client.automations.create({
      name: "Archived event flow",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "custom_event", reentry: "every_time" },
        },
        {
          id: "score",
          type: "action",
          position: { x: 200, y: 0 },
          config: { action: "change_score", amount: 1 },
        },
      ],
      edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
    });
    await client.automations.publish({ id: automation.id });
    await new ContactRepository(env.DB, {
      workspaceId,
      userId: "scoring-owner",
      role: "owner",
    }).archiveContact(contact.id);
    const failOnReconciliation = {
      send: async () => {
        throw new Error("Archived contacts must not enqueue segment reconciliation");
      },
      sendBatch: async () => {
        throw new Error("Archived contacts must not enqueue segment reconciliation");
      },
    } as unknown as Queue;

    const recorded = await recordContactEvent(createDatabase(env.DB), {
      workspaceId,
      contactId: contact.id,
      type: "custom_event",
      resourceId: "archive-then-track",
      queue: failOnReconciliation,
    });
    expect(recorded.enrollmentCount).toBe(0);

    await expect(readContact(contact.id)).resolves.toEqual({ score: 0, grade_points: 0 });
    await expect(
      countRows(
        `SELECT COUNT(*) AS count FROM contact_events
         WHERE id = ? AND contact_id = ? AND type = 'custom_event'`,
        recorded.eventId,
        contact.id,
      ),
    ).resolves.toBe(1);
    await expect(
      countRows("SELECT COUNT(*) AS count FROM score_events WHERE contact_id = ?", contact.id),
    ).resolves.toBe(0);
    await expect(
      countRows(
        "SELECT COUNT(*) AS count FROM contact_category_scores WHERE contact_id = ?",
        contact.id,
      ),
    ).resolves.toBe(0);
    await expect(
      countRows("SELECT COUNT(*) AS count FROM contact_tags WHERE contact_id = ?", contact.id),
    ).resolves.toBe(0);
    await expect(
      countRows(
        "SELECT COUNT(*) AS count FROM automation_enrollments WHERE contact_id = ?",
        contact.id,
      ),
    ).resolves.toBe(0);
  });
});

describe("grading", () => {
  it("moves the grade in thirds of a letter from the D baseline", async () => {
    const fixture = await seed("grade@example.com", { job_title: "営業部長" });
    await fixture.scoring.createCriterion({
      name: "意思決定者",
      field: "custom_field",
      fieldKey: "job_title",
      operator: "contains",
      value: "部長",
      steps: 3,
      enabled: true,
    });

    const points = await recomputeContactGrade(
      createDatabase(env.DB),
      fixture.workspaceId,
      fixture.contactId,
    );
    expect(points).toBe(3);
    expect(gradeLetter(points ?? 0)).toBe("C");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ grade_points: 3 });
  });

  it("nets positive and negative criteria and leaves an unmatched profile at D", async () => {
    const fixture = await seed("mixed@example.com", { job_title: "アシスタント", size: "5" });
    await fixture.scoring.createCriterion({
      name: "意思決定者",
      field: "custom_field",
      fieldKey: "job_title",
      operator: "contains",
      value: "部長",
      steps: 3,
      enabled: true,
    });
    await fixture.scoring.createCriterion({
      name: "小規模",
      field: "custom_field",
      fieldKey: "size",
      operator: "lt",
      value: "10",
      steps: -2,
      enabled: true,
    });

    const points = await recomputeContactGrade(
      createDatabase(env.DB),
      fixture.workspaceId,
      fixture.contactId,
    );
    expect(points).toBe(-2);
    expect(gradeLetter(points ?? 0)).toBe("F");

    const untouched = await seed("plain@example.com");
    const baseline = await recomputeContactGrade(
      createDatabase(env.DB),
      untouched.workspaceId,
      untouched.contactId,
    );
    expect(gradeLetter(baseline ?? 0)).toBe("D");
  });

  it("refreshes the grade as a side effect of any scored event", async () => {
    const fixture = await seed("auto@example.com", { tier: "enterprise" });
    await fixture.scoring.createCriterion({
      name: "エンタープライズ",
      field: "custom_field",
      fieldKey: "tier",
      operator: "eq",
      value: "enterprise",
      steps: 6,
      enabled: true,
    });

    await emit(fixture, "page_viewed", "https://example.com/");
    await expect(readContact(fixture.contactId)).resolves.toMatchObject({ grade_points: 6 });
  });
});
