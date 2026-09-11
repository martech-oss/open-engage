import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import * as repositories from "@openengage/database/automations";
import {
  createDatabase,
  automationEnrollments,
  automationJobs,
} from "@openengage/database/testing";

import { enrollContactManually } from "../src/automations/enrollment";
import { processAutomationJob } from "../src/automations/worker";
import { queueStub, runtimeWithJobsQueue } from "./automation-recovery-test-support";
import { seedWorkspaceClient } from "./factory";
it("awaits one pinned child, wakes parent once, and cascades explicit cancellation", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const child = await client.automations.create({
    name: "Child",
    nodes: [
      { id: "source", type: "source", position: { x: 0, y: 0 }, config: { source: "callable" } },
    ],
    edges: [],
  });
  await client.automations.publish({ id: child.id });
  const parent = await client.automations.create({
    name: "Parent",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "api_event", eventName: "start" },
      },
      {
        id: "call",
        type: "action",
        position: { x: 1, y: 0 },
        config: { action: "call_automation", automationId: child.id, mode: "await" },
      },
    ],
    edges: [{ id: "edge", source: "source", target: "call", branch: "next" }],
  });
  await client.automations.publish({ id: parent.id });
  const contact = await client.contacts.create({ email: "callable@example.com", customFields: {} });
  const db = createDatabase(env.DB),
    enrolled = await enrollContactManually(db, {
      workspaceId,
      automationId: parent.id,
      contactId: contact.id,
    });
  expect(enrolled.kind).toBe("enrolled");
  if (enrolled.kind !== "enrolled") return;
  const engine = new repositories.AutomationJobRepository(db),
    runtime = runtimeWithJobsQueue(queueStub());
  for (let round = 0; round < 2; round++)
    for (const job of await engine.claimDueJobs(new Date().toISOString(), "2099-01-01T00:00:00Z"))
      await processAutomationJob(job.id, job.leaseId, runtime);
  const detail = await new repositories.AutomationExecutionRepository(db, {
    workspaceId,
  }).enrollmentDetail(enrolled.result.enrollmentId);
  expect(detail?.children).toHaveLength(1);
  expect(detail?.jobs.find((j) => j.nodeId === "call")?.payload).toContain("waitingChild");
  await new repositories.AutomationExecutionRepository(db, { workspaceId }).cancelEnrollment(
    enrolled.result.enrollmentId,
  );
  const children = await db.orm
    .select({ status: automationEnrollments.status })
    .from(automationEnrollments)
    .where(eq(automationEnrollments.parentJobId, detail!.children[0]!.parentJobId!));
  expect(children).toEqual([{ status: "cancelled" }]);
  const jobs = await db.orm
    .select({ status: automationJobs.status })
    .from(automationJobs)
    .where(eq(automationJobs.enrollmentId, detail!.children[0]!.id));
  expect(jobs.every((j) => j.status === "cancelled")).toBe(true);
});

it.each(["await", "async"] as const)(
  "keeps child version pinned and handles failure with mode=%s",
  async (mode) => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const source = {
      id: "source",
      type: "source" as const,
      position: { x: 0, y: 0 },
      config: { source: "callable" as const },
    };
    const child = await client.automations.create({
      name: "Failing child",
      nodes: [
        source,
        {
          id: "bad",
          type: "action",
          position: { x: 1, y: 0 },
          config: { action: "update_field", field: "invalid/path", value: "value" },
        },
      ],
      edges: [{ id: "edge", source: "source", target: "bad", branch: "next" }],
    });
    const pinned = await client.automations.publish({ id: child.id });
    const parent = await client.automations.create({
      name: "Caller",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "start" },
        },
        {
          id: "call",
          type: "action",
          position: { x: 1, y: 0 },
          config: { action: "call_automation", automationId: child.id, mode },
        },
      ],
      edges: [{ id: "edge", source: "source", target: "call", branch: "next" }],
    });
    await client.automations.publish({ id: parent.id });
    await client.automations.saveDraft({
      id: child.id,
      name: "Fixed child",
      nodes: [source],
      edges: [],
    });
    await client.automations.publish({ id: child.id });
    const contact = await client.contacts.create({
      email: `${mode}-failure@example.com`,
      customFields: {},
    });
    const db = createDatabase(env.DB),
      enrolled = await enrollContactManually(db, {
        workspaceId,
        automationId: parent.id,
        contactId: contact.id,
      });
    expect(enrolled.kind).toBe("enrolled");
    if (enrolled.kind !== "enrolled") throw new Error("Expected enrollment");
    const engine = new repositories.AutomationJobRepository(db),
      calls = new repositories.AutomationCallRepository(db),
      runtime = runtimeWithJobsQueue(queueStub());
    for (let round = 0; round < 6; round++) {
      await calls.recover(new Date().toISOString());
      for (const job of await engine.claimDueJobs(new Date().toISOString(), "2099-01-01T00:00:00Z"))
        await processAutomationJob(job.id, job.leaseId, runtime).catch(() => undefined);
    }
    const detail = (await new repositories.AutomationExecutionRepository(db, {
      workspaceId,
    }).enrollmentDetail(enrolled.result.enrollmentId))!;
    expect(detail.status).toBe(mode === "await" ? "failed" : "completed");
    expect(detail.children).toHaveLength(1);
    expect(detail.children[0]).toMatchObject({
      automationVersionId: pinned.publishedVersionId,
      status: "failed",
    });
    expect(detail.jobs).toHaveLength(2);
    expect(await calls.recover(new Date().toISOString())).toBe(0);
    expect(await calls.claimChildFailures(new Date().toISOString())).toHaveLength(1);
    expect(await calls.claimChildFailures(new Date().toISOString())).toHaveLength(0);
  },
);
