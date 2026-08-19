import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";
import {
  automations,
  automationTriggers,
  automationVersions,
  contacts,
  createDatabase,
  gradingCriteria,
  projectItems,
  projects,
  scoringRules,
  uuidv7,
} from "@openengage/database";

import { processPendingPublicFormEvent, recordContactEvent } from "../src/contacts/event-service";
import { seedWorkspace } from "./factory";

const PROJECTIONS = [
  "scoring",
  "grade",
  "campaign",
  "decision_wake",
  "automation_enrollment",
  "segment_reconcile",
] as const;

describe("contact event projection durability schema", () => {
  it("stores six durable projections plus source-event effect keys", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const projectionColumns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('contact_event_projections')",
    ).all<{ name: string }>();
    const scoreColumns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('score_events')",
    ).all<{ name: string }>();
    const touchColumns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('campaign_touches')",
    ).all<{ name: string }>();

    expect(tables.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["contact_event_projections", "automation_action_effects"]),
    );
    expect(projectionColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["event_id", "projection", "status", "completed_at"]),
    );
    expect(scoreColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["contact_event_id", "scoring_rule_id"]),
    );
    expect(touchColumns.results.map((row) => row.name)).toContain("source_event_id");
  });

  it("backfills all six projections for pre-migration pending event work", async () => {
    const migrations = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name LIKE '0012_%' LIMIT 1",
    ).first<{ name: string }>();
    expect(migrations?.name).toMatch(/^0012_/);

    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contact_event_projections'",
    ).first<{ sql: string }>();
    expect(definition?.sql).toContain("contact_event_projections");
  });
});

describe("contact event projection recovery", () => {
  it.each(PROJECTIONS)(
    "resumes after %s completes its effect without replaying completed effects",
    async (failingProjection) => {
      const fixture = await seedProjectionFixture();
      const eventId = uuidv7();
      const sent: unknown[] = [];
      const queue = queueStub(async (messages) => {
        sent.push(...messages.map((message) => message.body));
      });
      const triggerName = `inject_projection_${failingProjection}`;
      await env.DB.prepare(
        `CREATE TRIGGER ${triggerName}
         BEFORE UPDATE OF status ON contact_event_projections
         WHEN OLD.event_id = '${eventId}'
           AND OLD.projection = '${failingProjection}'
           AND NEW.status = 'completed'
         BEGIN SELECT RAISE(FAIL, 'injected ${failingProjection} completion failure'); END`,
      ).run();

      let injectedFailure: unknown;
      try {
        await recordContactEvent(createDatabase(env.DB), {
          id: eventId,
          workspaceId: fixture.workspaceId,
          contactId: fixture.contactId,
          type: "form_submitted",
          resourceType: "form",
          resourceId: fixture.formId,
          occurredAt: fixture.now,
          queue,
        });
      } catch (error) {
        injectedFailure = error;
      }
      await env.DB.prepare(`DROP TRIGGER ${triggerName}`).run();
      expect(injectedFailure).toBeInstanceOf(Error);
      await env.DB.prepare(
        "UPDATE contact_event_outbox SET next_attempt_at = NULL WHERE event_id = ?",
      )
        .bind(eventId)
        .run();

      await processPendingPublicFormEvent(createDatabase(env.DB), eventId, queue);

      const state = await env.DB.prepare(
        `SELECT c.score, c.grade_points AS gradePoints,
                (SELECT COUNT(*) FROM score_events WHERE contact_event_id = ?) AS scoreEvents,
                (SELECT COUNT(*) FROM campaign_touches WHERE source_event_id = ?) AS touches,
                (SELECT COUNT(*) FROM automation_enrollments WHERE source_event_id = ?) AS enrollments,
                (SELECT status FROM contact_event_outbox WHERE event_id = ?) AS outboxStatus
         FROM contacts c WHERE c.id = ?`,
      )
        .bind(eventId, eventId, eventId, eventId, fixture.contactId)
        .first<{
          score: number;
          gradePoints: number;
          scoreEvents: number;
          touches: number;
          enrollments: number;
          outboxStatus: string;
        }>();
      expect(state).toEqual({
        score: 5,
        gradePoints: 1,
        scoreEvents: 1,
        touches: 1,
        enrollments: 1,
        outboxStatus: "processed",
      });
      const projections = await env.DB.prepare(
        `SELECT projection, status FROM contact_event_projections
         WHERE event_id = ? ORDER BY projection`,
      )
        .bind(eventId)
        .all<{ projection: string; status: string }>();
      expect(projections.results).toEqual(
        [...PROJECTIONS].sort().map((projection) => ({ projection, status: "completed" })),
      );
      expect(sent).toHaveLength(failingProjection === "segment_reconcile" ? 2 : 1);
    },
  );
});

async function seedProjectionFixture(): Promise<{
  workspaceId: string;
  contactId: string;
  formId: string;
  now: string;
}> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contactId = uuidv7();
  const formId = uuidv7();
  const projectId = uuidv7();
  const automationId = uuidv7();
  const versionId = uuidv7();
  const now = "2026-08-20T14:00:00.000Z";
  const definition: AutomationDefinition = {
    name: "Projection fixture",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "form_submitted", formId, reentry: "every_time" },
      },
    ],
    edges: [],
  };
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email: `${contactId}@example.com`,
      firstName: "Projection",
      status: "active",
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(scoringRules).values({
      id: uuidv7(),
      workspaceId,
      name: "Form score",
      eventType: "form_submitted",
      matchType: "any",
      points: 5,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(gradingCriteria).values({
      id: uuidv7(),
      workspaceId,
      name: "Named contact",
      field: "first_name",
      operator: "exists",
      value: "",
      steps: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "Projection campaign",
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(automations).values({
      id: automationId,
      workspaceId,
      name: "Projection automation",
      status: "active",
      publishedVersionId: versionId,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(automationVersions).values({
      id: versionId,
      workspaceId,
      automationId,
      version: 1,
      status: "published",
      timezone: "UTC",
      graph: JSON.stringify(definition),
      publishedAt: now,
      createdAt: now,
    }),
  ]);
  await orm.batch([
    orm.insert(projectItems).values({
      workspaceId,
      projectId,
      resourceType: "form",
      resourceId: formId,
      createdAt: now,
    }),
    orm.insert(automationTriggers).values({
      automationVersionId: versionId,
      workspaceId,
      automationId,
      sourceNodeId: "source",
      source: "form_submitted",
      eventType: "form_submitted",
      resourceId: formId,
      reentry: "every_time",
      createdAt: now,
    }),
  ]);
  return { workspaceId, contactId, formId, now };
}

function queueStub(
  sendBatch: (messages: Array<MessageSendRequest<unknown>>) => Promise<void> = async () => {},
): Queue {
  return { send: async () => {}, sendBatch } as unknown as Queue;
}
