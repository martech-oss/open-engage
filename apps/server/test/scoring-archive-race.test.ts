import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactEventRepository,
  ContactRepository,
  ContactResourceRepository,
  createDatabase,
  ScoringRepository,
  uuidv7,
} from "@openengage/database/testing";

import { processPendingPublicFormEvent } from "../src/contacts/event-service";
import { seedWorkspaceClient } from "./factory";

describe("scoring archive races", () => {
  it("stops business projections when the contact archives after the scoring precheck", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({ email: "archive-race@example.com" });
    const scoring = new ScoringRepository(env.DB, { workspaceId });
    const category = await scoring.createCategory({ name: "Intent", slug: "intent" });
    const tagId = uuidv7();
    await new ContactResourceRepository(env.DB, { workspaceId }).createTag({
      id: tagId,
      name: "Engaged",
      slug: "engaged",
      color: "#64748b",
    });
    await scoring.createRule({
      name: "Archive race rule",
      eventType: "custom_event",
      matchType: "any",
      matchValue: null,
      points: 25,
      categoryId: category.id,
      tagId,
      enabled: true,
    });
    const automation = await client.automations.create({
      name: "Archive race automation",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "custom_event", reentry: "every_time" },
        },
      ],
      edges: [],
    });
    await client.automations.publish({ id: automation.id });

    const eventId = uuidv7();
    const now = "2026-08-20T05:00:00.000Z";
    await new ContactEventRepository(createDatabase(env.DB)).create({
      id: eventId,
      workspaceId,
      contactId: contact.id,
      visitorId: null,
      type: "custom_event",
      resourceType: null,
      resourceId: null,
      properties: {},
      occurredAt: now,
      createdAt: now,
    });
    const reconciliationMessages: unknown[] = [];
    const queue = {
      send: async () => undefined,
      sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
        reconciliationMessages.push(...[...messages].map((message) => message.body));
      },
    } as unknown as Queue;
    const contacts = new ContactRepository(env.DB, { workspaceId, userId, role: "owner" });
    const racedBinding = beforeFirstBatch(env.DB, async () => {
      await contacts.archiveContact(contact.id);
    });

    await processPendingPublicFormEvent(createDatabase(racedBinding), eventId, queue);

    const effects = await env.DB.prepare(
      `SELECT c.status, c.score,
              (SELECT COUNT(*) FROM contact_category_scores ccs
               WHERE ccs.contact_id = c.id) AS categoryScores,
              (SELECT COUNT(*) FROM contact_tags ct
               WHERE ct.contact_id = c.id) AS contactTags,
              (SELECT COUNT(*) FROM score_events se
               WHERE se.contact_id = c.id) AS scoreEvents,
              (SELECT COUNT(*) FROM automation_enrollments ae
               WHERE ae.contact_id = c.id) AS enrollments,
              (SELECT COUNT(*) FROM segment_memberships sm
               WHERE sm.contact_id = c.id) AS segmentMemberships,
              (SELECT COUNT(*) FROM contact_events ce
               WHERE ce.id = ? AND ce.contact_id = c.id) AS auditEvents
       FROM contacts c WHERE c.id = ?`,
    )
      .bind(eventId, contact.id)
      .first<{
        status: string;
        score: number;
        categoryScores: number;
        contactTags: number;
        scoreEvents: number;
        enrollments: number;
        segmentMemberships: number;
        auditEvents: number;
      }>();
    expect.soft(effects).toEqual({
      status: "archived",
      score: 0,
      categoryScores: 0,
      contactTags: 0,
      scoreEvents: 0,
      enrollments: 0,
      segmentMemberships: 0,
      auditEvents: 1,
    });
    expect.soft(reconciliationMessages).toEqual([]);
  });
});

function beforeFirstBatch(binding: D1Database, barrier: () => Promise<void>): D1Database {
  let pending = true;
  return new Proxy(binding, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await barrier();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
