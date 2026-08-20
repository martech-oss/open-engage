import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  EmailTrackingSettingsRepository,
  MessagingWorkerRepository,
  createDatabase,
  emailTemplates,
  projectItems,
  projects,
  uuidv7,
} from "@openengage/database/testing";

import { applyEmailTracking } from "../src/messaging/email-tracking";
import { seedWorkspace } from "./factory";

const APP_URL = "https://app.example.com";

interface Seeded {
  workspaceId: string;
  contactId: string;
  deliveryId: string;
}

interface AttributedSeeded extends Seeded {
  projectId: string;
  templateId: string;
}

async function seedDelivery(label: string): Promise<Seeded> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "tracking-owner",
    role: "owner",
  }).createContact({ email: `${label}@example.com`, customFields: {} });
  const deliveryId = uuidv7();
  await new MessagingWorkerRepository(env.DB).insertQueuedDelivery({
    id: deliveryId,
    workspaceId,
    contactId: contact.id,
    enrollmentId: null,
    channel: "email",
    purpose: "transactional",
    provider: "cloudflare",
    recipient: contact.email,
    idempotencyKey: `tracking-${label}`,
    payload: "{}",
  });
  return { workspaceId, contactId: contact.id, deliveryId };
}

async function seedAttributedDelivery(label: string): Promise<AttributedSeeded> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "tracking-owner",
    role: "owner",
  }).createContact({ email: `${label}@example.com`, customFields: {} });
  const deliveryId = uuidv7();
  const projectId = uuidv7();
  const templateId = uuidv7();
  const now = "2026-08-20T12:00:00.000Z";
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(emailTemplates).values({
      id: templateId,
      workspaceId,
      name: "Attributed sequence",
      purpose: "marketing",
      draftSubject: "Hello",
      draftContent: "<p>Hello</p>",
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "Attributed campaign",
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(projectItems).values({
      workspaceId,
      projectId,
      resourceType: "email_sequence",
      resourceId: templateId,
      createdAt: now,
    }),
  ]);
  await new MessagingWorkerRepository(env.DB).insertQueuedDelivery({
    id: deliveryId,
    workspaceId,
    contactId: contact.id,
    enrollmentId: null,
    channel: "email",
    purpose: "marketing",
    provider: "cloudflare",
    recipient: contact.email,
    templateId,
    idempotencyKey: `tracking-${label}`,
    payload: "{}",
  });
  return { workspaceId, contactId: contact.id, deliveryId, projectId, templateId };
}

/** Renders one tracked link + pixel the same way the delivery worker does. */
async function trackedHtml(seeded: Seeded, destination: string): Promise<string> {
  return applyEmailTracking(`<body><a href="${destination}">go</a></body>`, {
    secret: env.TRACKING_SIGNING_SECRET,
    appUrl: APP_URL,
    workspaceId: seeded.workspaceId,
    deliveryId: seeded.deliveryId,
    contactId: seeded.contactId,
    openTracking: true,
    clickTracking: true,
  });
}

function pathOf(html: string, prefix: "t" | "c"): string {
  const token = new RegExp(`/${prefix}/([^"]+)"`).exec(html)?.[1] ?? "";
  return `/${prefix}/${token.replaceAll("&amp;", "&")}`;
}

/**
 * `redirect: "manual"` matters: the default follows the click redirect out to
 * the destination, which turns an asserted 302 into whatever that page returns.
 */
function call(path: string): Promise<Response> {
  return exports.default.fetch(new Request(`http://localhost:8787${path}`, { redirect: "manual" }));
}

/**
 * Both endpoints record through `executionCtx.waitUntil`, so the response can
 * land before the write does. Poll rather than sleep so the test stays fast.
 */
async function eventually(read: () => Promise<number>, expected: number): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read();
    if (value === expected) return value;
    await scheduler.wait(10);
  }
  return read();
}

/** For "still N" assertions, where polling for the expected value would pass instantly. */
async function settled(read: () => Promise<number>): Promise<number> {
  await scheduler.wait(50);
  return read();
}

async function countRows(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

const deliveryEventCount = (deliveryId: string, type: string) =>
  countRows(
    "SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ? AND type = ?",
    deliveryId,
    type,
  );

const contactEventCount = (contactId: string, type: string) =>
  countRows(
    "SELECT COUNT(*) AS count FROM contact_events WHERE contact_id = ? AND type = ?",
    contactId,
    type,
  );

describe("email open and click endpoints", () => {
  it("attributes an opened delivery to its canonical email sequence project", async () => {
    const seeded = await seedAttributedDelivery("attributed-open");
    const path = pathOf(await trackedHtml(seeded, "https://example.com/campaign"), "t");

    expect((await call(path)).status).toBe(200);
    await expect(
      eventually(
        () =>
          countRows(
            "SELECT COUNT(*) AS count FROM campaign_touches WHERE workspace_id = ? AND project_id = ? AND contact_id = ?",
            seeded.workspaceId,
            seeded.projectId,
            seeded.contactId,
          ),
        1,
      ),
    ).resolves.toBe(1);
    await expect(
      env.DB.prepare(
        `SELECT project_id AS projectId, resource_type AS resourceType,
                resource_id AS resourceId, event_type AS eventType
         FROM campaign_touches WHERE workspace_id = ? AND project_id = ?`,
      )
        .bind(seeded.workspaceId, seeded.projectId)
        .first(),
    ).resolves.toEqual({
      projectId: seeded.projectId,
      resourceType: "email_sequence",
      resourceId: seeded.templateId,
      eventType: "email_opened",
    });
  });

  it("records an open once, in both the delivery and contact timelines", async () => {
    const seeded = await seedDelivery("open");
    const path = pathOf(await trackedHtml(seeded, "https://example.com/a"), "t");

    const response = await call(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    await expect(
      eventually(() => deliveryEventCount(seeded.deliveryId, "opened"), 1),
    ).resolves.toBe(1);
    await expect(
      eventually(() => contactEventCount(seeded.contactId, "email_opened"), 1),
    ).resolves.toBe(1);

    // Apple Mail prefetches and re-renders: a second hit must not double-count.
    await call(path);
    await expect(settled(() => deliveryEventCount(seeded.deliveryId, "opened"))).resolves.toBe(1);
    await expect(settled(() => contactEventCount(seeded.contactId, "email_opened"))).resolves.toBe(
      1,
    );
  });

  it("redirects a click to the original destination and records it once", async () => {
    const seeded = await seedDelivery("click");
    const destination = "https://example.com/pricing?utm_source=oe&utm_medium=email";
    const path = pathOf(await trackedHtml(seeded, destination), "c");

    const response = await call(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(destination);
    await expect(
      eventually(() => deliveryEventCount(seeded.deliveryId, "clicked"), 1),
    ).resolves.toBe(1);
    await expect(
      eventually(() => contactEventCount(seeded.contactId, "email_clicked"), 1),
    ).resolves.toBe(1);

    await call(path);
    await expect(settled(() => deliveryEventCount(seeded.deliveryId, "clicked"))).resolves.toBe(1);
  });

  it("counts a second destination in the same delivery as its own click", async () => {
    const seeded = await seedDelivery("click-two");
    await call(pathOf(await trackedHtml(seeded, "https://example.com/one"), "c"));
    await call(pathOf(await trackedHtml(seeded, "https://example.com/two"), "c"));
    await expect(
      eventually(() => deliveryEventCount(seeded.deliveryId, "clicked"), 2),
    ).resolves.toBe(2);
  });

  it("ignores a tampered token without recording anything", async () => {
    const seeded = await seedDelivery("tampered");
    const html = await trackedHtml(seeded, "https://example.com/a");
    const tampered = `${pathOf(html, "t").slice(0, -3)}xyz`;

    expect((await call(tampered)).status).toBe(200);
    await expect(settled(() => deliveryEventCount(seeded.deliveryId, "opened"))).resolves.toBe(0);
    await expect(settled(() => contactEventCount(seeded.contactId, "email_opened"))).resolves.toBe(
      0,
    );
  });

  it("falls back to the app when a click token cannot be verified", async () => {
    const response = await call("/c/not-a-real-token");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(env.APP_URL);
  });
});

describe("email tracking settings", () => {
  it("defaults to off and round-trips both toggles", async () => {
    const { workspaceId } = await seedWorkspace(env.DB);
    const repository = new EmailTrackingSettingsRepository(env.DB, { workspaceId });

    await expect(repository.getSettings()).resolves.toMatchObject({
      openTrackingEnabled: false,
      clickTrackingEnabled: false,
      updatedAt: null,
    });

    await repository.updateSettings({ openTrackingEnabled: true, clickTrackingEnabled: false });
    await expect(repository.getSettings()).resolves.toMatchObject({
      openTrackingEnabled: true,
      clickTrackingEnabled: false,
    });

    await repository.updateSettings({ openTrackingEnabled: false, clickTrackingEnabled: true });
    const settings = await repository.getSettings();
    expect(settings.openTrackingEnabled).toBe(false);
    expect(settings.clickTrackingEnabled).toBe(true);
    expect(settings.updatedAt).not.toBeNull();
  });
});
