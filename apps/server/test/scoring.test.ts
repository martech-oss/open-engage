import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { gradeLetter } from "@openengage/core/scoring";
import { ContactRepository, createDatabase, ScoringRepository } from "@openengage/database";

import { recordContactEvent } from "../src/contacts/event-service";
import { recomputeContactGrade } from "../src/scoring/engine";
import { seedWorkspace } from "./factory";

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
