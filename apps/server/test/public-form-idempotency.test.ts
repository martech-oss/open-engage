import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MaintenanceRepository } from "@openengage/database";

import { runDailyMaintenance } from "../src/platform/maintenance-worker";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspaceClient } from "./factory";

afterEach(() => vi.restoreAllMocks());

function publicCall(path: string, body: Record<string, unknown>): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function createPublicForm(slugSuffix: string) {
  const fixture = await seedWorkspaceClient(env.DB);
  const formSlug = `atomic-${slugSuffix}`;
  await fixture.client.website.createForm({
    name: "Atomic form",
    slug: formSlug,
    status: "published",
    definition: {
      fields: [
        { key: "email", kind: "standard", type: "email", required: true },
        { key: "firstName", kind: "standard", type: "text" },
      ],
    },
    allowedDomains: [],
    turnstileEnabled: false,
    successMessage: "Accepted",
  });
  return { ...fixture, path: `/f/${fixture.slug}/${formSlug}` };
}

describe("public form atomic idempotency", () => {
  it("catches due-work queries scanning accumulated processed rows instead of partial indexes", async () => {
    const { workspaceId } = await seedWorkspaceClient(env.DB);
    const now = new Date().toISOString();
    const eventPrefix = `${workspaceId}-query-plan-`;
    await env.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 502
       )
       INSERT INTO contact_events (id, workspace_id, type, properties, occurred_at, created_at)
       SELECT ? || value, ?, 'form_submitted', '{}', ?, ? FROM sequence`,
    )
      .bind(eventPrefix, workspaceId, now, now)
      .run();
    await env.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 502
       )
       INSERT INTO contact_event_outbox
         (event_id, workspace_id, status, next_attempt_at, lease_id, lease_expires_at,
          created_at, processed_at)
       SELECT ? || value, ?,
         CASE value WHEN 501 THEN 'pending' WHEN 502 THEN 'processing' ELSE 'processed' END,
         CASE value WHEN 501 THEN ? ELSE NULL END,
         CASE value WHEN 502 THEN 'expired-lease' ELSE NULL END,
         CASE value WHEN 502 THEN ? ELSE NULL END,
         ?, CASE WHEN value <= 500 THEN ? ELSE NULL END
       FROM sequence`,
    )
      .bind(eventPrefix, workspaceId, now, "2000-01-01T00:00:00.000Z", now, now)
      .run();
    await env.DB.exec("ANALYZE contact_event_outbox");
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT event_id FROM contact_event_outbox
       WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (status = 'processing' AND lease_expires_at <= ?)
       ORDER BY created_at
       LIMIT 50`,
    )
      .bind(now, now)
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");

    expect(detail).toContain("contact_event_outbox_pending_due_idx");
    expect(detail).toContain("contact_event_outbox_processing_lease_idx");
  });

  it("catches daily maintenance retaining processed public-form work beyond seven days", async () => {
    // Keep the outbox purge real while isolating unrelated daily jobs. The
    // existing metrics rollup is outside this regression's behavior.
    vi.spyOn(MaintenanceRepository.prototype, "findEventsToArchive").mockResolvedValue([]);
    vi.spyOn(MaintenanceRepository.prototype, "rollupDailyMetrics").mockResolvedValue();
    vi.spyOn(MaintenanceRepository.prototype, "purgeExpiredIdempotencyKeys").mockResolvedValue();
    vi.spyOn(MaintenanceRepository.prototype, "reconcileContactScores").mockResolvedValue(0);
    const form = await createPublicForm("processed-retention");
    const response = await publicCall(form.path, {
      email: "retention@example.com",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(202);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE contact_event_outbox SET processed_at = ?
       WHERE event_id IN (
         SELECT id FROM contact_events WHERE workspace_id = ? AND type = 'contact_created'
       )`,
    )
      .bind(eightDaysAgo, form.workspaceId)
      .run();
    await env.DB.prepare(
      `UPDATE contact_event_outbox SET processed_at = ?
       WHERE event_id IN (
         SELECT id FROM contact_events WHERE workspace_id = ? AND type = 'form_submitted'
       )`,
    )
      .bind(sixDaysAgo, form.workspaceId)
      .run();

    await runDailyMaintenance(env);

    const remaining = await env.DB.prepare(
      `SELECT e.type FROM contact_event_outbox o
       JOIN contact_events e ON e.id = o.event_id
       WHERE o.workspace_id = ? ORDER BY e.type`,
    )
      .bind(form.workspaceId)
      .all<{ type: string }>();
    expect(remaining.results).toEqual([{ type: "form_submitted" }]);
  });

  it("catches a duplicate key with different payload mutating the existing contact", async () => {
    const form = await createPublicForm("duplicate");
    const idempotencyKey = crypto.randomUUID();
    const first = await publicCall(form.path, {
      email: "duplicate@example.com",
      firstName: "Original",
      idempotencyKey,
    });
    expect(await first.json()).toEqual({ data: { accepted: true, message: "Accepted" } });

    const duplicate = await publicCall(form.path, {
      email: "duplicate@example.com",
      firstName: "Mutated",
      idempotencyKey,
    });
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual({ data: { accepted: true, duplicate: true } });

    const contact = await env.DB.prepare(
      "SELECT first_name AS firstName FROM contacts WHERE email = ?",
    )
      .bind("duplicate@example.com")
      .first<{ firstName: string }>();
    expect(contact).toEqual({ firstName: "Original" });
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM form_submissions WHERE workspace_id = ?) AS submissions, (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ?) AS events",
    )
      .bind(form.workspaceId, form.workspaceId)
      .first<{ submissions: number; events: number }>();
    expect(counts).toEqual({ submissions: 1, events: 2 });
  });

  it("catches a same-email race losing one distinct accepted submission", async () => {
    const form = await createPublicForm("email-race");
    const [first, second] = await Promise.all([
      publicCall(form.path, {
        email: "race@example.com",
        firstName: "First",
        idempotencyKey: crypto.randomUUID(),
      }),
      publicCall(form.path, {
        email: "race@example.com",
        firstName: "Second",
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);

    expect([first.status, second.status]).toEqual([202, 202]);
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM contacts WHERE workspace_id = ? AND email = 'race@example.com') AS contacts, (SELECT COUNT(*) FROM form_submissions WHERE workspace_id = ?) AS submissions, (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ? AND type = 'contact_created') AS created_events, (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ? AND type = 'form_submitted') AS submitted_events",
    )
      .bind(form.workspaceId, form.workspaceId, form.workspaceId, form.workspaceId)
      .first<{
        contacts: number;
        submissions: number;
        created_events: number;
        submitted_events: number;
      }>();
    expect(counts).toEqual({
      contacts: 1,
      submissions: 2,
      created_events: 1,
      submitted_events: 2,
    });
  });

  it("catches scheduled scanners double-claiming pending work or reacquiring processed work", async () => {
    const form = await createPublicForm("scanner-claim");
    await form.client.scoring.createRule({
      name: "Form score",
      eventType: "form_submitted",
      matchType: "any",
      matchValue: null,
      points: 5,
      categoryId: null,
      tagId: null,
      enabled: true,
    });
    const submitted = await publicCall(form.path, {
      email: "scanner@example.com",
      firstName: "Scanner",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(submitted.status).toBe(202);
    const work = await env.DB.prepare(
      "SELECT o.event_id AS eventId, o.attempt_count AS attemptCount FROM contact_event_outbox o JOIN contact_events e ON e.id = o.event_id WHERE o.workspace_id = ? AND e.type = 'form_submitted'",
    )
      .bind(form.workspaceId)
      .first<{ eventId: string; attemptCount: number }>();
    expect(work).toMatchObject({ attemptCount: 1 });
    if (!work) throw new Error("form submission work was not created");
    await env.DB.prepare(
      "UPDATE contact_event_outbox SET status = 'pending', processed_at = NULL WHERE event_id = ?",
    )
      .bind(work.eventId)
      .run();

    const controller = createScheduledController({ cron: "* * * * *" });
    await Promise.all([
      scheduled(controller, env, createExecutionContext()),
      scheduled(controller, env, createExecutionContext()),
    ]);
    const afterConcurrentScan = await env.DB.prepare(
      "SELECT c.score, o.status, o.attempt_count AS attemptCount FROM contacts c JOIN contact_events e ON e.contact_id = c.id JOIN contact_event_outbox o ON o.event_id = e.id WHERE c.workspace_id = ? AND e.type = 'form_submitted'",
    )
      .bind(form.workspaceId)
      .first<{ score: number; status: string; attemptCount: number }>();
    expect(afterConcurrentScan).toEqual({ score: 10, status: "processed", attemptCount: 2 });

    await scheduled(controller, env, createExecutionContext());
    const afterProcessedScan = await env.DB.prepare(
      "SELECT c.score, o.attempt_count AS attemptCount FROM contacts c JOIN contact_events e ON e.contact_id = c.id JOIN contact_event_outbox o ON o.event_id = e.id WHERE c.workspace_id = ? AND e.type = 'form_submitted'",
    )
      .bind(form.workspaceId)
      .first<{ score: number; attemptCount: number }>();
    expect(afterProcessedScan).toEqual({ score: 10, attemptCount: 2 });
  });

  it("catches post-commit event failure losing durable retryable work", async () => {
    const form = await createPublicForm("pending-work");
    await env.DB.prepare("DROP TABLE scoring_rules").run();

    const response = await publicCall(form.path, {
      email: "pending@example.com",
      firstName: "Pending",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: true, message: "Accepted" } });

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM contacts WHERE workspace_id = ? AND email = 'pending@example.com') AS contacts, (SELECT COUNT(*) FROM form_submissions WHERE workspace_id = ?) AS submissions, (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ?) AS events, (SELECT COUNT(*) FROM contact_event_outbox WHERE workspace_id = ? AND status = 'pending') AS pending_work, (SELECT COUNT(*) FROM contact_event_outbox WHERE workspace_id = ? AND status = 'processed') AS processed_work",
    )
      .bind(
        form.workspaceId,
        form.workspaceId,
        form.workspaceId,
        form.workspaceId,
        form.workspaceId,
      )
      .first<{
        contacts: number;
        submissions: number;
        events: number;
        pending_work: number;
        processed_work: number;
      }>();
    expect(counts).toEqual({
      contacts: 1,
      submissions: 1,
      events: 2,
      pending_work: 1,
      processed_work: 1,
    });
  });

  it("catches a non-constraint persistence failure being reported as a duplicate after partial writes", async () => {
    const form = await createPublicForm("operational-error");
    await env.DB.prepare("DROP TABLE form_submissions").run();

    const response = await publicCall(form.path, {
      email: "operational@example.com",
      firstName: "Must roll back",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(500);

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM contacts WHERE workspace_id = ? AND email = 'operational@example.com') AS contacts, (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ?) AS events",
    )
      .bind(form.workspaceId, form.workspaceId)
      .first<{ contacts: number; events: number }>();
    expect(counts).toEqual({ contacts: 0, events: 0 });
  });
});
