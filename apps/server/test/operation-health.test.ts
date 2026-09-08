import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { AutomationRunRepository } from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";

import { operationHealth } from "../src/platform/operation-health-service";
import { seedWorkspaceClient } from "./factory";

it("shows recoverable failures only inside the administrator's workspace", async () => {
  const a = await seedWorkspaceClient(env.DB),
    b = await seedWorkspaceClient(env.DB);
  const project = await a.client.projects.create({ name: "Operations" });
  const preview = await a.client.projects.clonePreview({
    id: project.id,
    options: {
      name: "Copy",
      ownerUserId: null,
      approverUserId: null,
      reviewAt: null,
      variables: {},
    },
  });
  await env.DB.prepare(
    "UPDATE project_clone_jobs SET status='failed',error='Lost shared reference' WHERE id=?",
  )
    .bind(preview.id)
    .run();
  expect(await a.client.platform.operationHealth()).toEqual(
    expect.objectContaining({
      issues: expect.arrayContaining([
        expect.objectContaining({
          kind: "clone_failure",
          id: preview.id,
          message: "Lost shared reference",
          projectId: project.id,
        }),
      ]),
    }),
  );
  expect((await b.client.platform.operationHealth()).issues).toEqual([]);
  await a.client.projects.cloneRetry({ id: project.id, jobId: preview.id });
  expect((await a.client.platform.operationHealth()).issues).toEqual([]);
});

it("denies operations details to a viewer", async () => {
  const { client } = await seedWorkspaceClient(env.DB, { role: "viewer" });
  await expect(client.platform.operationHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("reports a missed scheduled slot after five minutes and clears it once a run exists", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const database = createDatabase(env.DB);
  const automation = await client.automations.create({
    name: "Daily operations",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: {
          source: "batch",
          reentry: "every_time",
          audience: {
            kind: "filter",
            filter: { kind: "condition", field: "score", operator: "gte", value: 0 },
          },
          schedule: { kind: "daily", hour: 9, minute: 0 },
        },
      },
    ],
    edges: [],
    timezone: "UTC",
  });
  await client.automations.publish({ id: automation.id });
  await client.automations.setStatus({ id: automation.id, status: "active" });
  await env.DB.prepare(
    "UPDATE automation_versions SET published_at='2026-09-01T00:00:00.000Z' WHERE automation_id=? AND status='published'",
  )
    .bind(automation.id)
    .run();
  expect(
    (await operationHealth(database, workspaceId, new Date("2026-09-08T09:04:00.000Z"))).issues,
  ).toEqual([]);
  expect(
    (await operationHealth(database, workspaceId, new Date("2026-09-08T09:05:00.000Z"))).issues,
  ).toEqual([
    expect.objectContaining({
      kind: "schedule_delay",
      automationId: automation.id,
      occurredAt: "2026-09-08T09:00:00.000Z",
    }),
  ]);
  await new AutomationRunRepository(database, { workspaceId }).startRun(
    automation.id,
    "2026-09-08T09:00:00.000Z",
  );
  expect(
    (await operationHealth(database, workspaceId, new Date("2026-09-08T09:06:00.000Z"))).issues,
  ).toEqual([]);
});
