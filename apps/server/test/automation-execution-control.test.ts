import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AutomationEnrollmentRepository } from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";

import { enrollContactManually } from "../src/automations/enrollment";
import { seedWorkspaceClient } from "./factory";
describe("automation enrollment policy", () => {
  it("applies published once policy to manual/API starts across request keys", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const automation = await client.automations.create({
      name: "Once",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "start", reentry: "once" },
        },
      ],
      edges: [],
    });
    await client.automations.publish({ id: automation.id });
    const contact = await client.contacts.create({ email: "once@example.com", customFields: {} });
    const start = (sourceEventId: string) =>
      enrollContactManually(createDatabase(env.DB), {
        workspaceId,
        automationId: automation.id,
        contactId: contact.id,
        sourceEventId,
      });
    expect(
      (await Promise.all([start("request-a"), start("request-b")])).filter(
        (r) => r.kind === "enrolled",
      ),
    ).toHaveLength(1);
  });
  it("enforces cooldown across versions at the exact boundary", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const automation = await client.automations.create({
      name: "Cooldown",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "start", reentry: "every_time" },
        },
      ],
      edges: [],
    });
    const version = await client.automations.publish({ id: automation.id });
    const contact = await client.contacts.create({
      email: "cooldown@example.com",
      customFields: {},
    });
    const repo = new AutomationEnrollmentRepository(createDatabase(env.DB), { workspaceId });
    const input = {
      automationId: automation.id,
      automationVersionId: version.publishedVersionId,
      contactId: contact.id,
      sourceNodeId: "source",
      reentry: "cooldown" as const,
      cooldownMinutes: 60,
      now: "2026-09-08T00:00:00.000Z",
    };
    expect(
      (
        await Promise.all([
          repo.enrollContact({ ...input, sourceEventId: "a" }),
          repo.enrollContact({ ...input, sourceEventId: "b" }),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
    const v2 = await client.automations.publish({ id: automation.id });
    expect(
      await repo.enrollContact({
        ...input,
        automationVersionId: v2.publishedVersionId,
        sourceEventId: "c",
        now: "2026-09-08T00:59:59.999Z",
      }),
    ).toBeNull();
    expect(
      await repo.enrollContact({
        ...input,
        automationVersionId: v2.publishedVersionId,
        sourceEventId: "d",
        now: "2026-09-08T01:00:00.000Z",
      }),
    ).not.toBeNull();
  });
});

it("deduplicates the original event even after once changes to every_time", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const node = {
    id: "source",
    type: "source" as const,
    position: { x: 0, y: 0 },
    config: { source: "api_event" as const, eventName: "start", reentry: "once" as const },
  };
  const graph = { name: "Policy change", nodes: [node], edges: [] };
  const created = await client.automations.create(graph);
  await client.automations.publish({ id: created.id });
  const contact = await client.contacts.create({
    email: "policy-change@example.com",
    customFields: {},
  });
  const db = createDatabase(env.DB),
    input = {
      workspaceId,
      automationId: created.id,
      contactId: contact.id,
      sourceEventId: "original-event",
    };
  expect((await enrollContactManually(db, input)).kind).toBe("enrolled");
  await client.automations.saveDraft({
    id: created.id,
    ...graph,
    nodes: [{ ...node, config: { ...node.config, reentry: "every_time" } }],
  });
  await client.automations.publish({ id: created.id });
  expect((await enrollContactManually(db, input)).kind).toBe("already_enrolled");
});
