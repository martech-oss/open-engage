import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { AutomationContactActionRepository } from "@openengage/database/automations";
import { ContactRepository, ContactTagRepository } from "@openengage/database/contacts";
import { contacts, createDatabase, uuidv7 } from "@openengage/database/testing";

import { seedAutomationJob } from "./automation-recovery-test-support";
import { seedWorkspaceClient } from "./factory";

function post(path: string, body: unknown): Promise<Response> {
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
    definition: {
      fields: [
        { key: "email", type: "email", required: true },
        { key: "firstName", type: "text" },
        { key: "lastName", type: "text" },
        { key: "job_title", kind: "custom", type: "text", progressive: true },
      ],
      progressiveMaxFields: 1,
    },
    allowedDomains: ["example.com"],
    turnstileEnabled: false,
    successMessage: "Thanks",
  });
  const known = await fixture.client.contacts.create({
    email: "known@example.com",
    firstName: "Known",
    phone: "+81-3-0000-0000",
    customFields: { job_title: "CEO", internal_tier: "vip" },
  });
  const track = async (body: Record<string, unknown> = {}) => {
    const response = await post(`/api/public/track/${fixture.slug}`, {
      consent: true,
      type: "page_viewed",
      resourceId: "https://example.com/pricing",
      ...body,
    });
    return (await response.json()) as {
      data: { visitorToken: string; visitorId: string; identified: boolean };
    };
  };
  const submit = async (body: Record<string, unknown>) => {
    const response = await post(`/f/${fixture.slug}/contact`, {
      idempotencyKey: crypto.randomUUID(),
      ...body,
    });
    expect(response.status).toBe(202);
    return (await response.json()) as { data: { visitorToken?: string } };
  };
  const readKnown = () =>
    env.DB.prepare(
      "SELECT first_name AS firstName, last_name AS lastName, status, custom_fields AS customFields FROM contacts WHERE id = ?",
    )
      .bind(known.id)
      .first<{
        firstName: string;
        lastName: string | null;
        status: string;
        customFields: string;
      }>();
  const bindingCount = (visitorId: string) =>
    env.DB.prepare("SELECT count(*) AS count FROM visitor_bindings WHERE visitor_id = ?")
      .bind(visitorId)
      .first<{ count: number }>()
      .then((row) => row?.count ?? 0);
  return { ...fixture, known, track, submit, readKnown, bindingCount };
}

describe("public form identity for an existing email", () => {
  it("records an unproven submission but only fills the contact's blank fields", async () => {
    const f = await setup();
    await f.submit({
      email: "known@example.com",
      firstName: "Impostor",
      lastName: "Added",
      "custom:job_title": "Intern",
    });
    const stored = await f.readKnown();
    expect(stored).toMatchObject({ firstName: "Known", lastName: "Added", status: "active" });
    expect(JSON.parse(stored!.customFields)).toEqual({ job_title: "CEO", internal_tier: "vip" });
    const submissions = await env.DB.prepare(
      "SELECT contact_id AS contactId FROM form_submissions WHERE workspace_id = ?",
    )
      .bind(f.workspaceId)
      .all<{ contactId: string }>();
    expect(submissions.results).toEqual([{ contactId: f.known.id }]);
  });

  it("does not bind a browser to an existing contact from a typed email alone", async () => {
    const f = await setup();
    const browser = await f.track();
    const result = await f.submit({
      email: "known@example.com",
      consent: true,
      oe_v: browser.data.visitorToken,
    });
    expect(await f.bindingCount(browser.data.visitorId)).toBe(0);
    const revisit = await f.track({ visitorToken: result.data.visitorToken });
    expect(revisit.data.identified).toBe(false);
    // Nor can that browser read which fields the contact has answered.
    const fields = await post(`/f/${f.slug}/contact/fields`, {
      email: "known@example.com",
      consent: true,
      visitorToken: result.data.visitorToken,
    });
    expect(await fields.json()).toEqual({ data: { answered: [] } });
  });

  it("updates the contact for a browser already proven to be theirs", async () => {
    const f = await setup();
    const browser = await f.track();
    const assertion = await f.client.website.issueIdentityToken({ contactId: f.known.id });
    const identified = await f.track({
      visitorToken: browser.data.visitorToken,
      identityToken: assertion.token,
    });
    expect(identified.data.identified).toBe(true);
    await f.submit({
      email: "known@example.com",
      firstName: "Renamed",
      consent: true,
      oe_v: identified.data.visitorToken,
    });
    await expect(f.readKnown()).resolves.toMatchObject({ firstName: "Renamed" });
  });

  it("reveals only this form's progressive fields to a proven browser", async () => {
    const f = await setup();
    const browser = await f.track();
    const assertion = await f.client.website.issueIdentityToken({ contactId: f.known.id });
    const identified = await f.track({
      visitorToken: browser.data.visitorToken,
      identityToken: assertion.token,
    });
    const fields = await post(`/f/${f.slug}/contact/fields`, {
      email: "known@example.com",
      consent: true,
      visitorToken: identified.data.visitorToken,
    });
    // firstName, phone and internal_tier hold values but are not progressive here.
    expect(await fields.json()).toEqual({ data: { answered: ["job_title"] } });
  });

  it("leaves an archived contact untouched while still accepting the submission", async () => {
    const f = await setup();
    await f.client.contacts.archive({ id: f.known.id });
    const browser = await f.track();
    await f.submit({
      email: "known@example.com",
      firstName: "Revived",
      lastName: "Added",
      consent: true,
      oe_v: browser.data.visitorToken,
    });
    const stored = await f.readKnown();
    expect(stored).toMatchObject({ firstName: "Known", lastName: null, status: "archived" });
    expect(await f.bindingCount(browser.data.visitorId)).toBe(0);
  });
});

describe("automation contact actions after archival", () => {
  it("skips profile and membership writes for a contact archived before the job ran", async () => {
    const seeded = await seedAutomationJob({ status: "running", leaseId: "lease" });
    const db = createDatabase(env.DB);
    const job = { id: seeded.jobId, workspaceId: seeded.workspaceId, contactId: seeded.contactId };
    const actions = new AutomationContactActionRepository(db);
    const now = new Date().toISOString();
    await actions.updateContactColumn(job, "lease", "first_name", "Before archive", now);
    await expect(
      new ContactRepository(db, {
        workspaceId: seeded.workspaceId,
        userId: "owner",
        role: "owner",
      }).archiveContact(seeded.contactId),
    ).resolves.toBe(true);

    await actions.updateContactColumn(job, "lease", "first_name", "After archive", now);
    await actions.replaceContactCustomFields(job, "lease", '{"tier":"gold"}', now);
    const tagId = uuidv7();
    await new ContactTagRepository(db, { workspaceId: seeded.workspaceId }).createTag({
      id: tagId,
      name: "Late",
      slug: "late",
      color: "#64748b",
    });
    await actions.addContactTag(job, "lease", tagId, now);
    const tagged = await env.DB.prepare(
      "SELECT count(*) AS count FROM contact_tags WHERE tag_id = ?",
    )
      .bind(tagId)
      .first<{ count: number }>();
    expect(tagged?.count).toBe(0);
    const stored = await db.orm
      .select({ firstName: contacts.firstName, customFields: contacts.customFields })
      .from(contacts)
      .where(eq(contacts.id, seeded.contactId))
      .get();
    expect(stored).toEqual({ firstName: "Before archive", customFields: "{}" });
  });
});
