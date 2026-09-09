import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { contactEvents, createDatabase, uuidv7 } from "@openengage/database/testing";

import { seedWorkspaceClient } from "./factory";

async function event(
  workspaceId: string,
  contactId: string | null,
  visitorId: string | null,
  at: string,
  source: Record<string, string>,
  type = "page_viewed",
) {
  await createDatabase(env.DB)
    .orm.insert(contactEvents)
    .values({
      id: uuidv7(),
      workspaceId,
      contactId,
      visitorId,
      type,
      resourceId: source.url ?? null,
      properties: JSON.stringify({ source }),
      occurredAt: at,
      createdAt: at,
    });
}

describe("acquisition report", () => {
  it("attributes period outcomes to the earliest retained source, merges bound visitors, and separates currency/workspace", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB, { timezone: "Asia/Tokyo" });
    const contact = await client.contacts.create({ email: "source@example.com", customFields: {} });
    const visitorId = uuidv7();
    await env.DB.prepare("INSERT INTO site_visitors(id,workspace_id,created_at) VALUES(?,?,?)")
      .bind(visitorId, workspaceId, "2025-12-20T00:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO visitor_bindings(workspace_id,visitor_id,contact_id,linked_at,history_status) VALUES(?,?,?,?,?)",
    )
      .bind(workspaceId, visitorId, contact.id, "2026-01-05T00:00:00.000Z", "done")
      .run();
    await event(workspaceId, null, visitorId, "2025-12-20T00:00:00.000Z", {
      url: "https://example.com/",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "winter",
    });
    await event(workspaceId, contact.id, visitorId, "2026-01-01T00:00:00.000Z", {
      url: "https://example.com/",
      utm_source: "later",
      utm_medium: "referral",
    });
    await event(workspaceId, contact.id, null, "2026-01-01T01:00:00.000Z", {
      url: "https://example.com/pricing",
    });
    await env.DB.prepare(
      "INSERT INTO contact_lifecycle_history(workspace_id,contact_id,stage,reached_at,source) VALUES(?,?,?,?,?)",
    )
      .bind(workspaceId, contact.id, "mql", "2026-01-01T02:00:00.000Z", "test")
      .run();
    const { pipelines } = await client.deals.options();
    const pipeline = pipelines[0]!;
    for (const currency of ["JPY", "USD"]) {
      const deal = await client.deals.create({
        name: currency,
        contactId: contact.id,
        value: 50000,
        currency,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0]!.id,
      });
      await env.DB.prepare("UPDATE deals SET status='won',created_at=?,won_at=? WHERE id=?")
        .bind("2026-01-01T03:00:00.000Z", "2026-01-31T14:59:59.000Z", deal.id)
        .run();
    }
    const report = await client.reports.acquisition({
      from: "2026-01-01",
      to: "2026-01-31",
      currency: "JPY",
    });
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({
      channel: "paid_search",
      source: "google",
      campaign: "winter",
      pageViews: 2,
      visitors: 1,
      mql: 1,
      dealsCreated: 1,
      won: 1,
      wonValue: 50000,
    });
    expect(report.summary).toMatchObject({ won: 1, wonValue: 50000, visitors: 1 });
    expect(report.attributionModel).toBe("first_retained_touch");
    const other = await seedWorkspaceClient(env.DB);
    expect(
      (await other.client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" })).sources,
    ).toEqual([]);
  });

  it("keeps outcomes with no prior source in unknown and excludes the upper time boundary", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB, { timezone: "Asia/Tokyo" });
    const contact = await client.contacts.create({
      email: "unknown@example.com",
      customFields: {},
    });
    const { pipelines } = await client.deals.options();
    const pipeline = pipelines[0]!;
    const deal = await client.deals.create({
      name: "Unknown",
      contactId: contact.id,
      value: 90,
      currency: "JPY",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
    });
    await env.DB.prepare("UPDATE deals SET status='won',created_at=?,won_at=? WHERE id=?")
      .bind("2026-01-01T01:00:00.000Z", "2026-01-01T02:00:00.000Z", deal.id)
      .run();
    await event(workspaceId, contact.id, null, "2026-01-31T15:00:00.000Z", {
      url: "https://example.com/",
      utm_source: "future",
      utm_medium: "cpc",
    });
    const report = await client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" });
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({
      channel: "unknown",
      pageViews: 0,
      won: 1,
      wonValue: 90,
    });
  });

  it("requires analyst access", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "viewer" });
    await expect(
      client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("normalizes external page source on the server and keeps reserved project metadata untrusted", async () => {
    const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
    await client.website.updateTracking({ enabled: true, allowedDomains: ["example.com"] });
    const response = await exports.default.fetch(
      new Request(`http://localhost/api/public/track/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com" },
        body: JSON.stringify({
          consent: true,
          type: "page_viewed",
          resourceId: "https://example.com/pricing?utm_source=google&utm_medium=cpc&secret=private",
          properties: {
            referrer: "https://search.test/?private=1",
            source: { utm_source: "forged" },
            projectId: "forged",
          },
        }),
      }),
    );
    expect(response.status).toBe(202);
    const row = await env.DB.prepare(
      "SELECT properties FROM contact_events WHERE workspace_id=? AND type='page_viewed'",
    )
      .bind(workspaceId)
      .first<{ properties: string }>();
    expect(JSON.parse(row!.properties)).toMatchObject({
      source: {
        url: "https://example.com/pricing",
        referrer: "https://search.test/",
        utm_source: "google",
        utm_medium: "cpc",
      },
    });
    expect(JSON.parse(row!.properties).projectId).toBeUndefined();
  });
});

it("counts authoritative form submissions once, including unlinked forms, without moving unknown acquisition to a later visit", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const first = await client.contacts.create({
    email: "forms-first@example.com",
    customFields: {},
  });
  const unknown = await client.contacts.create({
    email: "forms-unknown@example.com",
    customFields: {},
  });
  const form = await client.website.createForm({
    name: "Inquiry",
    slug: "inquiry",
    status: "published",
    definition: { style: "inline", fields: [{ key: "email", type: "email", required: true }] },
    allowedDomains: ["example.com"],
    turnstileEnabled: false,
    successMessage: "Thanks",
  });
  await event(workspaceId, first.id, null, "2025-12-01T00:00:00.000Z", {
    url: "https://example.com/",
    utm_source: "google",
    utm_medium: "cpc",
  });
  for (const contactId of [first.id, first.id, unknown.id, null]) {
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO form_submissions(id,workspace_id,form_id,contact_id,idempotency_key,payload,created_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(id, workspaceId, form.id, contactId, id, "{}", "2026-01-05T00:00:00.000Z")
      .run();
  }
  await event(workspaceId, first.id, null, "2026-01-05T00:00:00.000Z", {}, "form_submitted");
  await event(workspaceId, unknown.id, null, "2026-01-06T00:00:00.000Z", {
    url: "https://example.com/",
    utm_source: "later",
    utm_medium: "cpc",
  });
  const report = await client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" });
  expect(report.summary).toMatchObject({ submissions: 4, submittingContacts: 2 });
  expect(report.sources.find((row) => row.source === "google")).toMatchObject({
    submissions: 2,
    submittingContacts: 1,
  });
  expect(report.sources.find((row) => row.channel === "unknown")).toMatchObject({
    submissions: 2,
    submittingContacts: 1,
    pageViews: 1,
  });
  expect(report.sources.some((row) => row.source === "later")).toBe(false);
});

it("retains source attribution for form submissions with only a visitor link", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const form = await client.website.createForm({
    name: "Anonymous history",
    slug: "anonymous",
    status: "published",
    definition: { style: "inline", fields: [{ key: "email", type: "email", required: true }] },
    allowedDomains: ["example.com"],
    turnstileEnabled: false,
    successMessage: "Thanks",
  });
  const visitorId = uuidv7();
  await env.DB.prepare("INSERT INTO site_visitors(id,workspace_id,created_at) VALUES(?,?,?)")
    .bind(visitorId, workspaceId, "2026-01-01T00:00:00.000Z")
    .run();
  await event(workspaceId, null, visitorId, "2026-01-01T00:00:00.000Z", {
    url: "https://example.com/",
    utm_source: "partner",
    utm_medium: "referral",
  });
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO form_submissions(id,workspace_id,form_id,contact_id,visitor_id,idempotency_key,payload,created_at) VALUES(?,?,?,NULL,?,?,?,?)",
  )
    .bind(id, workspaceId, form.id, visitorId, id, "{}", "2026-01-05T00:00:00.000Z")
    .run();
  const report = await client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" });
  expect(report.sources).toHaveLength(1);
  expect(report.sources[0]).toMatchObject({
    source: "partner",
    visitors: 1,
    submissions: 1,
    submittingContacts: 0,
  });
  const contact = await client.contacts.create({
    email: "bound-form@example.com",
    customFields: {},
  });
  await env.DB.prepare(
    "INSERT INTO visitor_bindings(workspace_id,visitor_id,contact_id,linked_at,history_status) VALUES(?,?,?,?,?)",
  )
    .bind(workspaceId, visitorId, contact.id, "2026-01-06T00:00:00.000Z", "done")
    .run();
  const boundReport = await client.reports.acquisition({ from: "2026-01-01", to: "2026-01-31" });
  expect(boundReport.sources).toHaveLength(1);
  expect(boundReport.sources[0]).toMatchObject({
    source: "partner",
    visitors: 1,
    submissions: 1,
    submittingContacts: 1,
  });
});
