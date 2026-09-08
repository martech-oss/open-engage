import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { RuntimeEnv } from "../src/env";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspaceClient } from "./factory";

async function post(path: string, body: unknown) {
  return exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify(body),
    }),
  );
}

async function setup() {
  const fixture = await seedWorkspaceClient(env.DB);
  await fixture.client.website.updateTracking({ enabled: true, allowedDomains: ["example.com"] });
  await fixture.client.website.createForm({
    name: "Contact",
    slug: "contact",
    status: "published",
    definition: { fields: [{ key: "email", type: "email", required: true }] },
    allowedDomains: ["example.com"],
    turnstileEnabled: false,
    successMessage: "Thanks",
  });
  const track = async (body: Record<string, unknown> = {}) => {
    const response = await post(`/api/public/track/${fixture.slug}`, {
      consent: true,
      type: "page_viewed",
      resourceId: "https://example.com/pricing",
      ...body,
    });
    return (await response.json()) as {
      data: { visitorToken?: string; visitorId?: string; identified: boolean; accepted: boolean };
    };
  };
  return { ...fixture, track };
}

describe("consented visitor identity", () => {
  it("joins a submitted contact to return visits without resending an email", async () => {
    const { slug, workspaceId, track } = await setup();
    const anonymous = await track();
    expect(anonymous.data.visitorToken).toEqual(expect.any(String));
    expect(anonymous.data.identified).toBe(false);
    const submission = await post(`/f/${slug}/contact`, {
      email: "alice@example.com",
      consent: true,
      oe_v: anonymous.data.visitorToken,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(submission.status).toBe(202);
    const result = (await submission.json()) as { data: { visitorToken: string } };
    const revisit = await track({ visitorToken: result.data.visitorToken });
    expect(revisit.data.identified).toBe(true);
    expect(revisit.data.visitorId).toBe(anonymous.data.visitorId);
    const rows = await env.DB.prepare(
      "SELECT contact_id FROM contact_events WHERE workspace_id = ? AND type = 'page_viewed' ORDER BY created_at DESC",
    )
      .bind(workspaceId)
      .all<{ contact_id: string | null }>();
    expect(rows.results.some((row) => typeof row.contact_id === "string")).toBe(true);
  });

  it("restores anonymous history once without enrolling old page-view automations", async () => {
    const { slug, workspaceId, track, client } = await setup();
    await client.scoring.createRule({
      name: "Page view",
      eventType: "page_viewed",
      matchType: "any",
      matchValue: null,
      points: 5,
      categoryId: null,
      tagId: null,
      enabled: true,
    });
    const first = await track();
    await track({ visitorToken: first.data.visitorToken });
    await post(`/f/${slug}/contact`, {
      email: "history@example.com",
      consent: true,
      oe_v: first.data.visitorToken,
      idempotencyKey: crypto.randomUUID(),
    });
    const recover = () =>
      scheduled(
        createScheduledController({ cron: "* * * * *" }),
        env as unknown as RuntimeEnv,
        createExecutionContext(),
      );
    await recover();
    await recover();
    const rows = await env.DB.prepare(
      "SELECT contact_id, replay_mode FROM contact_events WHERE workspace_id = ? AND type = 'page_viewed'",
    )
      .bind(workspaceId)
      .all<{ contact_id: string | null; replay_mode: string }>();
    expect(rows.results).toHaveLength(2);
    expect(
      rows.results.every((row) => row.contact_id !== null && row.replay_mode === "history"),
    ).toBe(true);
    const liveEffects = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM contact_event_projections p JOIN contact_events e ON e.id = p.event_id WHERE e.workspace_id = ? AND e.replay_mode = 'history' AND p.projection IN ('automation_enrollment','decision_wake') AND p.status = 'completed'",
    )
      .bind(workspaceId)
      .first();
    expect(liveEffects).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT score FROM contacts WHERE workspace_id = ? AND email = ?")
        .bind(workspaceId, "history@example.com")
        .first(),
    ).toEqual({ score: 10 });
  });

  it("identifies multiple browsers through authenticated assertions and rejects another workspace", async () => {
    const { client, track, workspaceId } = await setup();
    const contact = await client.contacts.create({ email: "signed@example.com", customFields: {} });
    const assertion = await client.website.issueIdentityToken({ contactId: contact.id });
    const a = await track({ identityToken: assertion.token });
    const b = await track({ identityToken: assertion.token });
    expect(a.data.identified).toBe(true);
    expect(b.data.identified).toBe(true);
    expect(a.data.visitorId).not.toBe(b.data.visitorId);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM visitor_bindings WHERE workspace_id = ? AND contact_id = ?",
      )
        .bind(workspaceId, contact.id)
        .first(),
    ).toEqual({ count: 2 });
    const other = await setup();
    expect(
      (await other.track({ visitorToken: a.data.visitorToken, identityToken: assertion.token }))
        .data.identified,
    ).toBe(false);
  });

  it("keeps distinct contacts when concurrent forms share an anonymous browser", async () => {
    const { slug, workspaceId, track } = await setup();
    const first = await track();
    const responses = await Promise.all(
      ["a", "b"].map((name) =>
        post(`/f/${slug}/contact`, {
          email: `${name}@example.com`,
          consent: true,
          oe_v: first.data.visitorToken,
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(
      await env.DB.prepare(
        "SELECT count(DISTINCT contact_id) AS contacts, count(DISTINCT visitor_id) AS visitors FROM visitor_bindings WHERE workspace_id = ?",
      )
        .bind(workspaceId)
        .first(),
    ).toEqual({ contacts: 2, visitors: 2 });
  });

  it("rotates competing authenticated assertions without losing either event", async () => {
    const { client, track, workspaceId } = await setup();
    const anonymous = await track();
    const assertions = await Promise.all(
      ["one", "two"].map(async (name) => {
        const contact = await client.contacts.create({
          email: `${name}@example.com`,
          customFields: {},
        });
        return await client.website.issueIdentityToken({ contactId: contact.id });
      }),
    );
    const visits = await Promise.all(
      assertions.map((assertion) =>
        track({ visitorToken: anonymous.data.visitorToken, identityToken: assertion.token }),
      ),
    );
    expect(visits.every((visit) => visit.data?.identified)).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT count(DISTINCT contact_id) AS contacts FROM visitor_bindings WHERE workspace_id = ?",
      )
        .bind(workspaceId)
        .first(),
    ).toEqual({ contacts: 2 });
  });

  it("never issues another browser's identity from an idempotency key", async () => {
    const { slug, track } = await setup();
    const anonymous = await track();
    const key = crypto.randomUUID();
    const payload = {
      email: "retry@example.com",
      consent: true,
      oe_v: anonymous.data.visitorToken,
      idempotencyKey: key,
    };
    const first = await post(`/f/${slug}/contact`, payload);
    expect(first.status).toBe(202);
    const duplicate = await post(`/f/${slug}/contact`, { ...payload, oe_v: undefined });
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual({ data: { accepted: true, duplicate: true } });
    const changed = await post(`/f/${slug}/contact`, {
      ...payload,
      email: "someone-else@example.com",
    });
    expect(changed.status).toBe(409);
    const withdrawn = await post(`/f/${slug}/contact`, { ...payload, consent: false });
    expect(await withdrawn.json()).toEqual({ data: { accepted: true, duplicate: true } });
    const retry = await post(`/f/${slug}/contact`, payload);
    expect(((await retry.json()) as { data: { visitorToken?: string } }).data.visitorToken).toEqual(
      expect.any(String),
    );
  });

  it("does not accept a public email address or a forged visitor id as identity", async () => {
    const { client, track } = await setup();
    await client.contacts.create({ email: "known@example.com", customFields: {} });
    const result = await track({ email: "known@example.com", visitorId: crypto.randomUUID() });
    expect(result.data.identified).toBe(false);
    const forged = await track({ visitorToken: "forged.token" });
    expect(forged.data.identified).toBe(false);
  });

  it("does not link a form to browsing history without explicit consent", async () => {
    const { slug, track } = await setup();
    const anonymous = await track();
    expect(anonymous.data.visitorToken).toEqual(expect.any(String));
    const response = await post(`/f/${slug}/contact`, {
      email: "private@example.com",
      oe_v: anonymous.data.visitorToken,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(202);
    expect((await track({ visitorToken: anonymous.data.visitorToken })).data.identified).toBe(
      false,
    );
  });

  it("rotates a shared browser for another email and never transfers the old contact", async () => {
    const { slug, track } = await setup();
    const anonymous = await track();
    expect(anonymous.data.visitorToken).toEqual(expect.any(String));
    const submit = async (email: string, token: string) => {
      const response = await post(`/f/${slug}/contact`, {
        email,
        consent: true,
        oe_v: token,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(response.status).toBe(202);
      return (await response.json()) as { data: { visitorToken: string } };
    };
    const first = await submit("first@example.com", anonymous.data.visitorToken!);
    const second = await submit("second@example.com", first.data.visitorToken);
    const oldVisit = await track({ visitorToken: first.data.visitorToken });
    const newVisit = await track({ visitorToken: second.data.visitorToken });
    expect(newVisit.data.visitorId).not.toBe(oldVisit.data.visitorId);
    expect(newVisit.data.identified).toBe(true);
    expect(oldVisit.data.identified).toBe(true);
  });
});
