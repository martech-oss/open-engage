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

describe("scoring event processing", () => {
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
    await expect(
      countRows(
        "SELECT COUNT(*) AS count FROM contact_event_projections WHERE event_id = ? AND status = 'skipped'",
        recorded.eventId,
      ),
    ).resolves.toBe(6);
    const outbox = await env.DB.prepare(
      "SELECT status FROM contact_event_outbox WHERE event_id = ?",
    )
      .bind(recorded.eventId)
      .first<{ status: string }>();
    expect(outbox).toEqual({ status: "processed" });
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
