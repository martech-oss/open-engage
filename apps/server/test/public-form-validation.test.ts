import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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

describe("public form definition validation", () => {
  it("catches removal of implicit required-email and undeclared-field validation", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "Definition gate",
      slug: "definition-gate",
      status: "published",
      definition: { fields: [] },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    });

    const missingEmail = await publicCall(`/f/${slug}/definition-gate`, {
      idempotencyKey: crypto.randomUUID(),
    });
    expect(missingEmail.status).toBe(422);

    const undeclared = await publicCall(`/f/${slug}/definition-gate`, {
      email: "declared@example.com",
      firstName: "Not rendered",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(undeclared.status).toBe(422);

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM contacts) AS contacts, (SELECT COUNT(*) FROM form_submissions) AS submissions",
    ).first<{ contacts: number; submissions: number }>();
    expect(counts).toEqual({ contacts: 0, submissions: 0 });
  });

  it("catches accepting values rejected by the declared hosted control types", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "Typed form",
      slug: "typed-form",
      status: "published",
      definition: {
        fields: [
          { key: "email", kind: "standard", type: "email", required: true },
          { key: "website", kind: "custom", type: "url" },
          { key: "seats", kind: "custom", type: "number" },
          { key: "start_date", kind: "custom", type: "date" },
          {
            key: "plan",
            kind: "custom",
            type: "select",
            options: ["starter", "growth"],
          },
          { key: "note", kind: "custom", type: "text" },
        ],
      },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    });

    const invalidBodies = [
      { "custom:website": "not a url" },
      { "custom:seats": "many" },
      { "custom:start_date": "2026-02-30" },
      { "custom:plan": "enterprise" },
      { "custom:note": 42 },
    ];
    for (const invalid of invalidBodies) {
      const response = await publicCall(`/f/${slug}/typed-form`, {
        email: "typed@example.com",
        ...invalid,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(response.status).toBe(422);
    }

    const valid = await publicCall(`/f/${slug}/typed-form`, {
      email: "typed@example.com",
      "custom:website": "https://example.com/path",
      "custom:seats": "12.5",
      "custom:start_date": "2026-08-20",
      "custom:plan": "growth",
      "custom:note": "Call next week",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(valid.status).toBe(202);
  });

  it("catches validation drifting from progressive fields selected for oe_v", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "Progressive form",
      slug: "progressive-form",
      status: "published",
      definition: {
        progressiveMaxFields: 1,
        fields: [
          { key: "email", kind: "standard", type: "email", required: true },
          { key: "role", kind: "custom", type: "text", progressive: true },
          { key: "industry", kind: "custom", type: "text", progressive: true },
        ],
      },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    });
    const first = await publicCall(`/f/${slug}/progressive-form`, {
      email: "progressive@example.com",
      "custom:role": "Director",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(first.status).toBe(202);
    await env.DB.prepare("UPDATE contacts SET visitor_id = ? WHERE email = ?")
      .bind("visitor-progressive", "progressive@example.com")
      .run();

    const staleField = await publicCall(`/f/${slug}/progressive-form`, {
      email: "progressive@example.com",
      "custom:role": "VP",
      oe_v: "visitor-progressive",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(staleField.status).toBe(422);

    const nextField = await publicCall(`/f/${slug}/progressive-form`, {
      email: "progressive@example.com",
      "custom:industry": "Manufacturing",
      oe_v: "visitor-progressive",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(nextField.status).toBe(202);
  });
});
