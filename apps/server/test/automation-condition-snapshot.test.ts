import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  AutomationJobRepository,
  AutomationDecisionRepository,
  AutomationContactActionRepository,
} from "@openengage/database/automations";
import { contacts, createDatabase } from "@openengage/database/testing";

import { executeNode } from "../src/automations/worker";
import {
  graph,
  seedAutomationJob,
  queueStub,
  runtimeWithJobsQueue,
} from "./automation-recovery-test-support";
it("stores a rich condition result and keeps the same branch after contact changes and retry", async () => {
  const node = {
    id: "condition",
    type: "condition" as const,
    position: { x: 0, y: 0 },
    config: {
      filter: {
        kind: "condition" as const,
        field: "score" as const,
        operator: "gte" as const,
        value: 10,
      },
    },
  };
  const definition = graph([node]);
  const seeded = await seedAutomationJob({
    status: "running",
    leaseId: "lease",
    nodeId: node.id,
    graph: definition,
  });
  const db = createDatabase(env.DB),
    engine = new AutomationJobRepository(db);
  await db.orm.update(contacts).set({ score: 20 }).where(eq(contacts.id, seeded.contactId));
  const job = await engine.findJobForProcessing(seeded.jobId, "lease");
  expect(job).not.toBeNull();
  expect(
    await executeNode(
      node,
      definition,
      job!,
      "lease",
      runtimeWithJobsQueue(queueStub()),
      db,
      new AutomationDecisionRepository(db),
      new AutomationContactActionRepository(db),
    ),
  ).toMatchObject({ branch: "yes" });
  await db.orm.update(contacts).set({ score: 0 }).where(eq(contacts.id, seeded.contactId));
  const retry = await engine.findJobForProcessing(seeded.jobId, "lease");
  expect(
    await executeNode(
      node,
      definition,
      retry!,
      "lease",
      runtimeWithJobsQueue(queueStub()),
      db,
      new AutomationDecisionRepository(db),
      new AutomationContactActionRepository(db),
    ),
  ).toMatchObject({ branch: "yes" });
});
it("advances an already elapsed delay instead of waiting again", async () => {
  const node = {
    id: "delay",
    type: "delay" as const,
    position: { x: 0, y: 0 },
    config: { mode: "relative" as const, minutes: 5 },
  };
  const definition = graph([node]);
  const seeded = await seedAutomationJob({
    status: "running",
    leaseId: "lease",
    nodeId: node.id,
    graph: definition,
  });
  const db = createDatabase(env.DB),
    engine = new AutomationJobRepository(db),
    job = await engine.findJobForProcessing(seeded.jobId, "lease");
  expect(
    await executeNode(
      node,
      definition,
      { ...job!, payload: { waiting: true } },
      "lease",
      runtimeWithJobsQueue(queueStub()),
      db,
      new AutomationDecisionRepository(db),
      new AutomationContactActionRepository(db),
    ),
  ).toEqual({ branch: "next" });
});
