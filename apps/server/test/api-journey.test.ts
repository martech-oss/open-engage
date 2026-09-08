import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspace } from "./factory";

/**
 * Executable specification of the public /api/v1 REST surface.
 *
 * /api/v1 is served by the oRPC OpenAPIHandler from the same procedures as
 * /api/rpc, so this file deliberately uses raw fetch instead of the typed
 * client: it pins the wire-level behavior SDKs and external consumers see.
 *
 * Semantics under test:
 * - Bearer API-key auth.
 * - Path params inline (/contacts/{id}), GET inputs as query params.
 * - POST/PATCH JSON body = procedure input minus path params.
 * - Success responses are the procedure output as plain JSON — no
 *   {data}/{meta} envelope — with camelCase keys, and the status code
 *   declared by the contract (successStatus 201/202 where set, else 200).
 * - Errors are the oRPC OpenAPI error JSON:
 *   {defined: true, code, status, message, data?} with the matching HTTP status.
 */
describe("workspace API journey", () => {
  it("moves a contact through segmentation, automation setup and dashboard reporting", async () => {
    const api = await seedApiWorkspace();

    const health = await exports.default.fetch("http://localhost:8787/api/health");
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { data: { status: string } };
    expect(healthBody.data.status).toBe("ok");

    const createdContact = await api("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email: "journey@example.com",
        firstName: "Journey",
        customFields: { source: "e2e" },
      }),
    });
    expect(createdContact.status).toBe(201);
    const contact = (await createdContact.json()) as {
      id: string;
      email: string;
      firstName: string;
      customFields: Record<string, unknown>;
    };
    expect(contact).toMatchObject({
      email: "journey@example.com",
      firstName: "Journey",
      customFields: { source: "e2e" },
    });
    expect(contact).not.toHaveProperty("data");

    const listedContacts = await api("/contacts?query=journey&status=active");
    expect(listedContacts.status).toBe(200);
    const contactPage = (await listedContacts.json()) as {
      items: Array<{ id: string; firstName: string | null }>;
      total: number;
    };
    expect(contactPage.total).toBe(1);
    expect(contactPage.items[0]).toMatchObject({ id: contact.id, firstName: "Journey" });

    // Query strings arrive as text; ZodSmartCoercionPlugin turns them into the
    // schema's declared number/boolean types before validation.
    const coerced = await api("/contacts?scoreMin=50");
    expect(coerced.status).toBe(200);
    const coercedPage = (await coerced.json()) as { items: unknown[]; total: number };
    expect(coercedPage.total).toBe(0);

    const createdSegment = await api("/segments", {
      method: "POST",
      body: JSON.stringify({
        name: "Active contacts",
        slug: "active-contacts",
        kind: "dynamic",
        filter: {
          kind: "condition",
          field: "status",
          operator: "eq",
          value: "active",
        },
      }),
    });
    expect(createdSegment.status).toBe(201);
    await expect(createdSegment.json()).resolves.toMatchObject({
      slug: "active-contacts",
      kind: "dynamic",
    });

    const preview = await api("/segments/preview", {
      method: "POST",
      body: JSON.stringify({
        filter: {
          kind: "condition",
          field: "email",
          operator: "eq",
          value: "journey@example.com",
        },
      }),
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      capped: false,
      contacts: [expect.objectContaining({ id: contact.id, customFields: { source: "e2e" } })],
    });

    const createdAutomation = await api("/automations", {
      method: "POST",
      body: JSON.stringify({
        name: "Welcome journey",
        description: "",
        timezone: "UTC",
        nodes: [
          {
            id: "source",
            type: "source",
            position: { x: 0, y: 0 },
            config: { source: "contact_created", reentry: "once" },
          },
          {
            id: "score",
            type: "action",
            position: { x: 200, y: 0 },
            config: { action: "change_score", amount: 5 },
          },
        ],
        edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
      }),
    });
    expect(createdAutomation.status).toBe(201);
    const automation = (await createdAutomation.json()) as { id: string; draftVersionId: string };
    expect(automation.draftVersionId).toBeTruthy();

    const automations = (await (await api("/automations")).json()) as Array<{
      name: string;
      status: string;
      enrollmentCount: number;
    }>;
    expect(automations).toEqual([
      expect.objectContaining({ name: "Welcome journey", status: "draft", enrollmentCount: 0 }),
    ]);

    const published = await api(`/automations/${automation.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      publishedVersionId: expect.any(String),
      draftVersionId: expect.any(String),
    });

    const enrolled = await api(`/automations/${automation.id}/enroll`, {
      method: "POST",
      body: JSON.stringify({ contactId: contact.id }),
    });
    expect(enrolled.status).toBe(202);
    const enrollment = (await enrolled.json()) as { enrollmentId: string; jobId: string };
    expect(enrollment.enrollmentId).toBeTruthy();
    expect(enrollment.jobId).toBeTruthy();

    const segments = (await (await api("/segments")).json()) as Array<{
      slug: string;
      memberCount: number;
    }>;
    expect(segments).toEqual([
      expect.objectContaining({ slug: "active-contacts", memberCount: 1 }),
    ]);

    const dashboardResponse = await api("/dashboard");
    expect(dashboardResponse.status).toBe(200);
    const dashboard = (await dashboardResponse.json()) as {
      contacts: { count: number };
      automations: { count: number };
      recentEvents: unknown[];
    };
    expect(dashboard.contacts.count).toBe(1);
    expect(dashboard.automations.count).toBe(1);
    expect(dashboard.recentEvents).toEqual([
      expect.objectContaining({ contactId: contact.id, type: "segment_joined", properties: {} }),
      expect.objectContaining({ contactId: contact.id, type: "contact_created", properties: {} }),
    ]);

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const report = await api(`/reports/contacts?from=${from}&to=${to}`);
    expect(report.status).toBe(200);
    await expect(report.json()).resolves.toMatchObject({
      category: "contacts",
      range: { from, to },
      summary: expect.objectContaining({ totalContacts: 1 }),
    });
  });

  it("rejects webhook endpoints that could target local infrastructure", async () => {
    const api = await seedApiWorkspace();
    const rejected = await api("/workspace/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: "Private target",
        url: "https://10.0.0.8/hook",
        eventTypes: [],
      }),
    });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      defined: true,
      code: "UNSAFE_WEBHOOK_URL",
      status: 422,
      message: expect.any(String),
    });

    const created = await api("/workspace/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: "CRM sync",
        url: "https://hooks.example.com/openengage",
        eventTypes: ["contact.created"],
      }),
    });
    expect(created.status).toBe(201);
    const endpoint = (await created.json()) as { id: string; signingSecret: string };
    expect(endpoint.id).toBeTruthy();
    expect(endpoint.signingSecret.length).toBeGreaterThanOrEqual(40);
  });
});

async function seedApiWorkspace(): Promise<
  (path: string, init?: RequestInit) => Promise<Response>
> {
  const { token } = await seedWorkspace(env.DB);

  return (path, init) =>
    exports.default.fetch(
      new Request(`http://localhost:8787/api/v1${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
      }),
    );
}
