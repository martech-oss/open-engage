import type { ContractRouterClient } from "@orpc/contract";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { contactEvents, contacts, createDatabase } from "@openengage/database/testing";
import type { contract } from "@openengage/orpc";

import { enrollInactiveContacts } from "../src/automations/enrollment";
import { seedWorkspaceClient } from "./factory";

type Client = ContractRouterClient<typeof contract>;

describe("Automation flows", () => {
  it("enrolls a newly created contact into a published welcome flow", async () => {
    const { client, workspaceId } = await createWorkspaceClient();
    const automation = await client.automations.create({
      name: "Welcome flow",
      description: "Welcome new contacts",
      timezone: "Asia/Tokyo",
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
    });
    expect(automation.id).toBeTruthy();
    const published = await client.automations.publish({ id: automation.id });
    expect(published.publishedVersionId).toBeTruthy();

    const contact = await client.contacts.create({
      email: "welcome@example.com",
      customFields: {},
    });
    const enrollment = await env.DB.prepare(
      `SELECT ce.status, ce.current_node_id, ce.source_event_id, cj.status AS job_status
       FROM automation_enrollments ce
       JOIN automation_jobs cj ON cj.enrollment_id = ce.id
       WHERE ce.workspace_id = ? AND ce.automation_id = ? AND ce.contact_id = ?`,
    )
      .bind(workspaceId, automation.id, contact.id)
      .first<{
        status: string;
        current_node_id: string;
        source_event_id: string;
        job_status: string;
      }>();
    expect(enrollment).toMatchObject({
      status: "active",
      current_node_id: "source",
      source_event_id: expect.any(String),
      job_status: "pending",
    });
  });

  it("supports repeatable cart events and once-only inactivity enrollment", async () => {
    const { client, workspaceId } = await createWorkspaceClient();
    const contact = await client.contacts.create({
      email: "behavior@example.com",
      customFields: {},
    });
    const cartAutomationId = await createAndPublishSingleActionFlow(client, {
      name: "Cart flow",
      source: {
        source: "api_event",
        eventName: "cart_abandoned",
        reentry: "every_time",
      },
    });

    for (let index = 0; index < 2; index += 1) {
      const recorded = await client.contacts.recordEvent({
        id: contact.id,
        eventName: "cart_abandoned",
        properties: { cartId: `cart-${index}` },
      });
      expect(recorded).toMatchObject({ enrollmentCount: 1 });
    }
    const cartEnrollments = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM automation_enrollments
       WHERE workspace_id = ? AND automation_id = ? AND contact_id = ?`,
    )
      .bind(workspaceId, cartAutomationId, contact.id)
      .first<{ count: number }>();
    expect(cartEnrollments?.count).toBe(2);

    const inactivityAutomationId = await createAndPublishSingleActionFlow(client, {
      name: "Re-engagement flow",
      source: { source: "contact_inactive", days: 30, reentry: "once" },
    });
    const orm = createDatabase(env.DB).orm;
    await orm
      .update(contacts)
      .set({ createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contact.id)));
    await orm
      .delete(contactEvents)
      .where(
        and(eq(contactEvents.workspaceId, workspaceId), eq(contactEvents.contactId, contact.id)),
      );

    expect(
      await enrollInactiveContacts(createDatabase(env.DB), new Date("2026-07-30T00:00:00.000Z")),
    ).toBe(1);
    expect(
      await enrollInactiveContacts(createDatabase(env.DB), new Date("2026-07-30T00:01:00.000Z")),
    ).toBe(0);
    const inactivityEnrollments = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM automation_enrollments
       WHERE workspace_id = ? AND automation_id = ? AND contact_id = ?`,
    )
      .bind(workspaceId, inactivityAutomationId, contact.id)
      .first<{ count: number }>();
    expect(inactivityEnrollments?.count).toBe(1);
  });
});

async function createAndPublishSingleActionFlow(
  client: Client,
  input: {
    name: string;
    source:
      | { source: "api_event"; eventName: string; reentry: "every_time" }
      | { source: "contact_inactive"; days: number; reentry: "once" };
  },
): Promise<string> {
  const created = await client.automations.create({
    name: input.name,
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: input.source,
      },
      {
        id: "score",
        type: "action",
        position: { x: 200, y: 0 },
        config: { action: "change_score", amount: 1 },
      },
    ],
    edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
  });
  expect(created.id).toBeTruthy();
  const published = await client.automations.publish({ id: created.id });
  expect(published.publishedVersionId).toBeTruthy();
  return created.id;
}

async function createWorkspaceClient(): Promise<{ client: Client; workspaceId: string }> {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  return { client, workspaceId };
}
