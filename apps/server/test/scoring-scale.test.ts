import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  ScoringRepository,
  createDatabase,
  uuidv7,
} from "@openengage/database/testing";

import { recordContactEvent } from "../src/runtime/contact-event-service";
import { applyScoringForEvent, recomputeContactGrade } from "../src/scoring/engine";
import { seedWorkspaceClient } from "./factory";

async function fixture() {
  const seeded = await seedWorkspaceClient(env.DB);
  const contact = await new ContactRepository(env.DB, seeded).createContact({
    email: "scale@example.com",
  });
  return { ...seeded, contactId: contact.id, repository: new ScoringRepository(env.DB, seeded) };
}

async function addRules(workspaceId: string, count: number) {
  const ids = Array.from(
    { length: count },
    (_, index) => `rule-${String(index).padStart(4, "0")}-${uuidv7()}`,
  );
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        "INSERT INTO scoring_rules(id,workspace_id,name,event_type,match_type,points,enabled,created_at,updated_at) VALUES (?,?,'Same name','page_viewed','any',1,1,'2026-01-01','2026-01-01')",
      ).bind(id, workspaceId),
    ),
  );
  return ids;
}

describe("scoring beyond administrative page limits", () => {
  it("applies all 201 rules once and exposes every rule through pages", async () => {
    const f = await fixture();
    await addRules(f.workspaceId, 201);
    const result = await recordContactEvent(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
    });
    await applyScoringForEvent(createDatabase(env.DB), {
      id: result.eventId,
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
    });
    expect(
      await env.DB.prepare("SELECT score FROM contacts WHERE id=?").bind(f.contactId).first(),
    ).toEqual({ score: 201 });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await f.client.scoring.listRules({ limit: 100, ...(cursor ? { cursor } : {}) });
      expect(page.total).toBe(201);
      expect(page.items.length).toBeLessThanOrEqual(100);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(201);
    expect(seen).toHaveLength(201);
  });

  it("uses criteria beyond the 200th instead of silently ignoring them", async () => {
    const f = await fixture();
    await env.DB.batch(
      Array.from({ length: 201 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO grading_criteria(id,workspace_id,name,field,operator,value,steps,enabled,created_at,updated_at) VALUES (?,?,?,'email','eq',?,1,1,'2026-01-01','2026-01-01')",
        ).bind(
          `criterion-${String(index).padStart(4, "0")}-${uuidv7()}`,
          f.workspaceId,
          "Same name",
          index === 200 ? "scale@example.com" : "other@example.com",
        ),
      ),
    );
    await expect(
      recomputeContactGrade(createDatabase(env.DB), f.workspaceId, f.contactId),
    ).resolves.toBe(1);
    const page = await f.client.scoring.listCriteria({});
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(201);
    expect(page.nextCursor).toBeTruthy();
  });

  it("resumes after a failed score batch without repeating the committed first 50 rules", async () => {
    const f = await fixture();
    const ids = await addRules(f.workspaceId, 101);
    await env.DB.exec(
      `CREATE TRIGGER inject_later_score_failure BEFORE INSERT ON score_events WHEN NEW.scoring_rule_id = '${ids[50]}' BEGIN SELECT RAISE(FAIL,'later batch'); END;`,
    );
    await expect(
      recordContactEvent(createDatabase(env.DB), {
        workspaceId: f.workspaceId,
        contactId: f.contactId,
        type: "page_viewed",
      }),
    ).rejects.toThrow(/later batch/);
    expect(
      await env.DB.prepare("SELECT score FROM contacts WHERE id=?").bind(f.contactId).first(),
    ).toEqual({ score: 50 });
    await env.DB.exec("DROP TRIGGER inject_later_score_failure");
    const event = await env.DB.prepare("SELECT id FROM contact_events WHERE contact_id=?")
      .bind(f.contactId)
      .first<{ id: string }>();
    await applyScoringForEvent(createDatabase(env.DB), {
      id: event!.id,
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      type: "page_viewed",
    });
    expect(
      await env.DB.prepare("SELECT score FROM contacts WHERE id=?").bind(f.contactId).first(),
    ).toEqual({ score: 101 });
  });
});
