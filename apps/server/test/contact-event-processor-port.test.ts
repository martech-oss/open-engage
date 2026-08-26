import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";
import type { ContactEventProjection } from "@openengage/database/contacts";

import {
  ContactEventProcessor,
  type ContactEventProjectionRunner,
} from "../src/contacts/event-service";
import { seedWorkspaceClient } from "./factory";

const projectionOrder: ContactEventProjection[] = [
  "scoring",
  "grade",
  "campaign",
  "decision_wake",
  "automation_enrollment",
  "segment_reconcile",
];

describe("contact event processor projection port", () => {
  it("runs durable projections in repository order through the injected runner", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({ email: "projection-port@example.com" });
    const observed: ContactEventProjection[] = [];
    const runProjection: ContactEventProjectionRunner = async ({ projection }) => {
      observed.push(projection);
      return projection === "segment_reconcile"
        ? { outcome: "skipped", enrollmentCount: 0 }
        : { outcome: "completed", enrollmentCount: projection === "automation_enrollment" ? 2 : 0 };
    };
    const processor = new ContactEventProcessor(createDatabase(env.DB), runProjection);

    const result = await processor.record({
      workspaceId,
      contactId: contact.id,
      type: "custom_event",
      resourceId: "injected-runner",
    });

    expect(observed).toEqual(projectionOrder);
    expect(result.enrollmentCount).toBe(2);
    const checkpoints = await env.DB.prepare(
      `SELECT projection, status FROM contact_event_projections
       WHERE event_id = ? ORDER BY rowid`,
    )
      .bind(result.eventId)
      .all<{ projection: string; status: string }>();
    expect(checkpoints.results).toEqual([
      { projection: "scoring", status: "completed" },
      { projection: "grade", status: "completed" },
      { projection: "campaign", status: "completed" },
      { projection: "decision_wake", status: "completed" },
      { projection: "automation_enrollment", status: "completed" },
      { projection: "segment_reconcile", status: "skipped" },
    ]);
  });

  it("resumes with the first unfinished projection after a runner failure", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({ email: "projection-resume@example.com" });
    const eventId = crypto.randomUUID();
    const firstAttempt: ContactEventProjection[] = [];
    const failingRunner: ContactEventProjectionRunner = async ({ projection }) => {
      firstAttempt.push(projection);
      if (projection === "campaign") throw new Error("campaign unavailable");
      return { outcome: "completed", enrollmentCount: 0 };
    };

    await expect(
      new ContactEventProcessor(createDatabase(env.DB), failingRunner).record({
        id: eventId,
        workspaceId,
        contactId: contact.id,
        type: "custom_event",
      }),
    ).rejects.toThrow("campaign unavailable");
    expect(firstAttempt).toEqual(["scoring", "grade", "campaign"]);
    await env.DB.prepare(
      "UPDATE contact_event_outbox SET next_attempt_at = NULL WHERE event_id = ?",
    )
      .bind(eventId)
      .run();

    const resumed: ContactEventProjection[] = [];
    const successfulRunner: ContactEventProjectionRunner = async ({ projection }) => {
      resumed.push(projection);
      return { outcome: "completed", enrollmentCount: 0 };
    };
    await new ContactEventProcessor(createDatabase(env.DB), successfulRunner).process(eventId);

    expect(resumed).toEqual([
      "campaign",
      "decision_wake",
      "automation_enrollment",
      "segment_reconcile",
    ]);
    const outbox = await env.DB.prepare(
      "SELECT status, attempt_count AS attemptCount FROM contact_event_outbox WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ status: string; attemptCount: number }>();
    expect(outbox).toEqual({ status: "processed", attemptCount: 2 });
  });
});
