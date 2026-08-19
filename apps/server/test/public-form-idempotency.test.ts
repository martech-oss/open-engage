import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspaceClient } from "./factory";

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
