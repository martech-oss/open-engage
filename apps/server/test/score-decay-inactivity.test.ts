import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { AutomationInactivityRepository } from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";

import { enrollInactiveContacts } from "../src/automations/enrollment";
import { recordContactEvent } from "../src/runtime/contact-event-service";
import { runScoringDecay } from "../src/scoring/decay-service";
import { seedWorkspaceClient } from "./factory";

it.each(["once", "every_time", "cooldown"] as const)(
  "does not reset inactivity or reentry identity during score decay (%s)",
  async (reentry) => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "inactive@example.com",
      customFields: {},
    });
    await env.DB.prepare("UPDATE contacts SET created_at=? WHERE id=?")
      .bind("2026-07-01T00:00:00.000Z", contact.id)
      .run();
    await env.DB.prepare(
      "UPDATE contact_events SET occurred_at=? WHERE workspace_id=? AND contact_id=?",
    )
      .bind("2026-07-01T00:00:00.000Z", workspaceId, contact.id)
      .run();
    await client.scoring.createRule({
      name: "Aging",
      eventType: "page_viewed",
      points: 100,
      decayDays: 100,
    });
    const database = createDatabase(env.DB);
    const lastActivity = "2026-08-01T00:00:00.000Z";
    await recordContactEvent(database, {
      workspaceId,
      contactId: contact.id,
      type: "page_viewed",
      occurredAt: lastActivity,
    });
    const automation = await client.automations.create({
      name: "Inactive",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: {
            source: "contact_inactive",
            days: 30,
            reentry,
            ...(reentry === "cooldown" ? { cooldownMinutes: 60 } : {}),
          },
        },
        {
          id: "wait",
          type: "delay",
          position: { x: 100, y: 0 },
          config: { mode: "relative", minutes: 60 },
        },
      ],
      edges: [{ id: "next", source: "source", target: "wait", branch: "next" }],
    });
    await client.automations.publish({ id: automation.id });
    const now = new Date("2026-09-11T00:00:00.000Z");
    const repository = new AutomationInactivityRepository(database);
    expect(await repository.listInactiveEnrollmentCandidates(now.toISOString(), 100)).toEqual([
      expect.objectContaining({ contactId: contact.id, lastActivityAt: lastActivity }),
    ]);
    await runScoringDecay(database, undefined, now);
    expect(await repository.listInactiveEnrollmentCandidates(now.toISOString(), 100)).toEqual([
      expect.objectContaining({ contactId: contact.id, lastActivityAt: lastActivity }),
    ]);
    expect(await enrollInactiveContacts(database, now)).toBe(1);
    const later = new Date("2026-10-20T00:00:00.000Z");
    await runScoringDecay(database, undefined, later);
    expect(await enrollInactiveContacts(database, later)).toBe(0);
  },
);
