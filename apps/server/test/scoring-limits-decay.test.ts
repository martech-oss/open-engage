import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { scoringRuleWriteSchema } from "@openengage/core/scoring";
import { ContactRepository, ScoringRepository, createDatabase } from "@openengage/database/testing";

import { recordContactEvent } from "../src/runtime/contact-event-service";
import { applyScoringForEvent } from "../src/scoring/engine";
import { seedWorkspace } from "./factory";

async function seed() {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "owner",
    role: "owner",
  }).createContact({ email: "limits@example.com" });
  const scoring = new ScoringRepository(env.DB, { workspaceId });
  const category = await scoring.createCategory({ name: "Product", slug: "product" });
  return { workspaceId, contactId: contact.id, scoring, categoryId: category.id };
}
const rule = { name: "Visits", eventType: "page_viewed", points: 20 } as const;
async function score(contactId: string) {
  return (
    await env.DB.prepare("SELECT score FROM contacts WHERE id = ?")
      .bind(contactId)
      .first<{ score: number }>()
  )?.score;
}

describe("scoring limits", () => {
  it("caps each contact's live contribution and records the actual delta on concurrent events and retries", async () => {
    const f = await seed();
    await f.scoring.createRule(
      scoringRuleWriteSchema.parse({ ...rule, categoryId: f.categoryId, maxScore: 25 }),
    );
    const input = { workspaceId: f.workspaceId, contactId: f.contactId, type: "page_viewed" };
    const results = await Promise.all([
      recordContactEvent(createDatabase(env.DB), input),
      recordContactEvent(createDatabase(env.DB), input),
    ]);
    expect(
      (await applyScoringForEvent(createDatabase(env.DB), { ...input, id: results[0]!.eventId }))
        .total,
    ).toBe(0);
    expect(await score(f.contactId)).toBe(25);
    const category = await env.DB.prepare(
      "SELECT score FROM contact_category_scores WHERE contact_id = ?",
    )
      .bind(f.contactId)
      .first<{ score: number }>();
    expect(category?.score).toBe(25);
    const events = await env.DB.prepare(
      "SELECT delta FROM score_events WHERE contact_id = ? ORDER BY delta",
    )
      .bind(f.contactId)
      .all<{ delta: number }>();
    expect(events.results.map((e) => e.delta)).toEqual([5, 20]);
  });
  it("validates positive-only options and preserves omitted defaults", () => {
    expect(scoringRuleWriteSchema.parse(rule)).toMatchObject({ decayDays: null, maxScore: null });
    for (const options of [
      { decayDays: 0 },
      { maxScore: 0 },
      { decayDays: 1.5 },
      { points: -1, decayDays: 10 },
      { points: 0, tagId: "tag", maxScore: 20 },
    ]) {
      expect(scoringRuleWriteSchema.safeParse({ ...rule, ...options }).success).toBe(false);
    }
  });
});

describe("scoring decay", () => {
  it("decays in whole event days, retains manual adjustments and original category after archival, and retries once", async () => {
    const f = await seed();
    const created = await f.scoring.createRule(
      scoringRuleWriteSchema.parse({ ...rule, decayDays: 10, categoryId: f.categoryId }),
    );
    const occurredAt = new Date(Date.now() - 5 * 86400000).toISOString();
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
      occurredAt,
    });
    // Delayed event processing applies its already-aged contribution.
    expect(await score(f.contactId)).toBe(10);
    await env.DB.prepare("UPDATE contacts SET score = score + 5 WHERE id = ?")
      .bind(f.contactId)
      .run();
    await f.scoring.archiveRule(created!.id);
    await f.scoring.archiveCategory(f.categoryId);
    const { runScoringDecay } = await import("../src/scoring/decay-service");
    const future = new Date(Date.parse(occurredAt) + 10 * 86400000);
    await Promise.all([
      runScoringDecay(createDatabase(env.DB), undefined, future),
      runScoringDecay(createDatabase(env.DB), undefined, future),
    ]);
    await runScoringDecay(createDatabase(env.DB), undefined, future);
    expect(await score(f.contactId)).toBe(5);
    const category = await env.DB.prepare(
      "SELECT score FROM contact_category_scores WHERE contact_id = ?",
    )
      .bind(f.contactId)
      .first<{ score: number }>();
    expect(category?.score).toBe(0);
    const history = await env.DB.prepare(
      "SELECT sum(delta) as delta FROM score_events WHERE contact_id = ?",
    )
      .bind(f.contactId)
      .first<{ delta: number }>();
    expect(history?.delta).toBe(0);
  });
});

describe("decay reevaluation", () => {
  it("bounds work, updates score-based grades, and durably queues downstream projections", async () => {
    const f = await seed();
    await f.scoring.createRule(scoringRuleWriteSchema.parse({ ...rule, decayDays: 2 }));
    await f.scoring.createCriterion({
      name: "Engaged",
      field: "score",
      fieldKey: null,
      operator: "gte",
      value: "20",
      steps: 3,
      enabled: true,
    });
    const occurredAt = new Date().toISOString();
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
      occurredAt,
    });
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
      occurredAt,
    });
    const messages: unknown[] = [];
    const queue = {
      sendBatch: async (batch: Iterable<MessageSendRequest<unknown>>) => {
        messages.push(...batch);
      },
    } as unknown as Queue;
    const { runScoringDecay } = await import("../src/scoring/decay-service");
    const future = new Date(Date.parse(occurredAt) + 2 * 86400000);
    await runScoringDecay(createDatabase(env.DB), queue, future, 1);
    expect(await score(f.contactId)).toBe(20);
    await runScoringDecay(createDatabase(env.DB), queue, future, 1);
    expect(await score(f.contactId)).toBe(0);
    const contact = await env.DB.prepare("SELECT grade_points FROM contacts WHERE id = ?")
      .bind(f.contactId)
      .first<{ grade_points: number }>();
    expect(contact?.grade_points).toBe(0);
    expect(messages).toHaveLength(2);
    const projections = await env.DB.prepare(
      "SELECT count(*) AS count FROM contact_event_projections p JOIN contact_events e ON e.id = p.event_id WHERE e.contact_id = ? AND e.type = 'score_changed' AND p.status = 'completed'",
    )
      .bind(f.contactId)
      .first<{ count: number }>();
    expect(projections?.count).toBe(12);
  });
});
