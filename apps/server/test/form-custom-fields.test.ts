import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

function publicCall(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return exports.default.fetch(new Request(`http://localhost:8787${path}`, { ...init, headers }));
}

async function readCustomFields(email: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT custom_fields FROM contacts WHERE email = ?")
    .bind(email)
    .first<{ custom_fields: string }>();
  return JSON.parse(row?.custom_fields ?? "{}") as Record<string, unknown>;
}

const FIELDS = [
  { key: "email", kind: "standard", type: "email", required: true, progressive: false },
  {
    key: "job_title",
    kind: "custom",
    label: "役職",
    type: "text",
    required: false,
    progressive: true,
  },
  {
    key: "industry",
    kind: "custom",
    label: "業種",
    type: "text",
    required: false,
    progressive: true,
  },
] as const;

describe("form custom fields and progressive profiling", () => {
  it("stores custom answers on the contact and merges later submissions", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "資料請求",
      slug: "download",
      status: "published",
      definition: { style: "inline", fields: [...FIELDS], progressiveMaxFields: 2 },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "ありがとうございます。",
    });

    const first = await publicCall(`/f/${slug}/download`, {
      method: "POST",
      body: JSON.stringify({
        email: "lead@example.com",
        "custom:job_title": "営業部長",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(first.status).toBe(202);
    await expect(readCustomFields("lead@example.com")).resolves.toEqual({ job_title: "営業部長" });

    // A second visit answering a different question must not erase the first.
    const second = await publicCall(`/f/${slug}/download`, {
      method: "POST",
      body: JSON.stringify({
        email: "lead@example.com",
        "custom:industry": "製造",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(second.status).toBe(202);
    await expect(readCustomFields("lead@example.com")).resolves.toEqual({
      job_title: "営業部長",
      industry: "製造",
    });
  });

  it("asks a returning visitor only for what they have not answered", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "資料請求",
      slug: "profiling",
      status: "published",
      definition: { style: "inline", fields: [...FIELDS], progressiveMaxFields: 1 },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "ありがとうございます。",
    });
    const submission = await publicCall(`/f/${slug}/profiling`, {
      method: "POST",
      body: JSON.stringify({
        email: "returning@example.com",
        consent: true,
        "custom:job_title": "課長",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const {
      data: { visitorToken },
    } = (await submission.json()) as { data: { visitorToken: string } };

    const anonymous = await (await publicCall(`/f/${slug}/profiling`)).text();
    expect(anonymous).toContain('name="custom:job_title"');

    const known = await (
      await publicCall(`/f/${slug}/profiling?consent=true&oe_v=${encodeURIComponent(visitorToken)}`)
    ).text();
    expect(known).toContain('name="custom:job_title"');
    const fieldsResponse = await publicCall(`/f/${slug}/profiling/fields`, {
      method: "POST",
      body: JSON.stringify({ email: "returning@example.com", consent: true, visitorToken }),
    });
    expect(await fieldsResponse.json()).toEqual({ data: { answered: ["job_title"] } });
    const otherResponse = await publicCall(`/f/${slug}/profiling/fields`, {
      method: "POST",
      body: JSON.stringify({ email: "other@example.com", consent: true, visitorToken }),
    });
    expect(await otherResponse.json()).toEqual({ data: { answered: [] } });
    expect(known).toContain('name="custom:industry"');
    expect(known).toContain(`name="oe_v" value="${visitorToken}"`);
  });

  it("hands the visitor id from the embed script to the hosted form", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    await client.website.createForm({
      name: "資料請求",
      slug: "embed",
      status: "published",
      definition: { style: "inline", fields: [...FIELDS] },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "ありがとうございます。",
    });
    const script = await (await publicCall(`/api/public/forms/${slug}/embed/embed.js`)).text();
    expect(script).toContain(`openengage_visitor_" + "${slug}"`);
    expect(script).toContain("oe_v=");
  });
});
