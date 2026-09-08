import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";

import * as repositories from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";
import { contacts } from "@openengage/database/testing";

import { processAutomationRun } from "../src/automations/run-service";
import { queueStub } from "./automation-recovery-test-support";
import { seedWorkspaceClient } from "./factory";
it("freezes run targets at start and replays the same slot without adding new contacts", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const first = await client.contacts.create({
    email: "snapshot-first@example.com",
    customFields: {},
  });
  const definition = {
    name: "Batch",
    nodes: [
      {
        id: "source",
        type: "source" as const,
        position: { x: 0, y: 0 },
        config: {
          source: "batch" as const,
          reentry: "every_time" as const,
          audience: {
            kind: "filter" as const,
            filter: {
              kind: "condition" as const,
              field: "score" as const,
              operator: "gte" as const,
              value: 0,
            },
          },
          schedule: { kind: "now" as const },
        },
      },
    ],
    edges: [],
  };
  const created = await client.automations.create(definition);
  // Repository existence is asserted before publish, to isolate the absent run behavior.
  await client.automations.publish({ id: created.id });
  const repo = new repositories.AutomationRunRepository(createDatabase(env.DB), { workspaceId });
  const run = await repo.startRun(created.id, "manual:request");
  await client.contacts.create({ email: "snapshot-later@example.com", customFields: {} });
  expect((await repo.startRun(created.id, "manual:request")).id).toBe(run.id);
  const detail = await repo.runDetail(run.id);
  expect(detail!.targets.map((target) => target.contactId)).toEqual([first.id]);
});

it("continues bounded queue chunks from the fixed ledger despite audience changes and archive", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB),
    db = createDatabase(env.DB);
  const first = await client.contacts.create({
      email: "chunk-first@example.com",
      customFields: {},
    }),
    second = await client.contacts.create({ email: "chunk-second@example.com", customFields: {} });
  await db.orm
    .update(contacts)
    .set({ score: 20 })
    .where(inArray(contacts.id, [first.id, second.id]));
  const created = await client.automations.create({
    name: "Chunks",
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
            filter: { kind: "condition", field: "score", operator: "gte", value: 10 },
          },
          schedule: { kind: "now" },
        },
      },
    ],
    edges: [],
  });
  await client.automations.publish({ id: created.id });
  const repo = new repositories.AutomationRunRepository(db, { workspaceId }),
    run = await repo.startRun(created.id, "manual:chunks");
  await db.orm.update(contacts).set({ status: "archived" }).where(eq(contacts.id, first.id));
  await db.orm.update(contacts).set({ score: 0 }).where(eq(contacts.id, second.id));
  await client.contacts.create({ email: "chunk-late@example.com", customFields: {} });
  const sent: unknown[] = [];
  const queue = {
    ...queueStub(),
    send: async (message: unknown) => {
      sent.push(message);
    },
  } as Queue;
  await processAutomationRun(run.id, workspaceId, db, 1, queue);
  expect(sent).toEqual([{ kind: "automation_run", workspaceId, runId: run.id }]);
  await processAutomationRun(run.id, workspaceId, db, 1, queue);
  await processAutomationRun(run.id, workspaceId, db, 1, queue);
  const detail = (await repo.runDetail(run.id))!;
  expect(detail.run).toMatchObject({
    targetCount: 2,
    enrolledCount: 1,
    skippedCount: 1,
    pendingCount: 0,
    status: "running",
  });
  expect(detail.targets.find((target) => target.contactId === second.id)?.status).toBe("enrolled");
  await repo.cancelRun(run.id);
  expect((await repo.runDetail(run.id))?.run.status).toBe("cancelled");
  expect(
    (
      await new repositories.AutomationExecutionRepository(db, { workspaceId }).enrollmentDetail(
        detail.targets.find((target) => target.enrollmentId)!.enrollmentId!,
      )
    )?.status,
  ).toBe("cancelled");
});
