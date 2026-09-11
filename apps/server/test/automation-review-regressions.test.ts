import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  automationDefinitionSchema,
  pinAutomationDependencies,
  type AutomationSchedule,
} from "@openengage/core/automations";
import type { SegmentFilter } from "@openengage/core/segments";
import {
  AutomationQueryRepository,
  AutomationCommandRepository,
  AutomationJobRepository,
  AutomationJobRecoveryRepository,
  AutomationRunRepository,
} from "@openengage/database/automations";
import {
  automations,
  automationVersions,
  automationTriggers,
  automationJobs,
  customFieldDefinitions,
  createDatabase,
  uuidv7,
} from "@openengage/database/testing";

import { dispatchScheduledAutomationRuns } from "../src/automations/run-service";
import { processAutomationJob } from "../src/automations/worker";
import {
  graph,
  seedAutomationJob,
  queueStub,
  runtimeWithJobsQueue,
  expectJobAndEnrollment,
} from "./automation-recovery-test-support";
import { seedWorkspaceClient } from "./factory";

it("rejects a stale publication atomically and preserves the concurrently saved draft", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB),
    db = createDatabase(env.DB);
  const definition = (amount: number) =>
    automationDefinitionSchema.parse({
      name: "Concurrent",
      nodes: [
        { id: "source", type: "source", position: { x: 0, y: 0 }, config: { source: "callable" } },
        {
          id: "score",
          type: "action",
          position: { x: 1, y: 0 },
          config: { action: "change_score", amount },
        },
      ],
      edges: [{ id: "edge", source: "source", target: "score", branch: "next" }],
    });
  const a = definition(1),
    b = definition(999),
    created = await client.automations.create(a);
  const automationQuery = new AutomationQueryRepository(db, { workspaceId }),
    automationCommand = new AutomationCommandRepository(db, { workspaceId }),
    draft = (await automationQuery.findPublishableDraft(created.id))!;
  const snapshot = await pinAutomationDependencies(
    created.id,
    a,
    { schemaVersion: 1, projectId: null, values: [] },
    async () => null,
  );
  await client.automations.saveDraft({ id: created.id, ...b });
  await expect(
    automationCommand.publishDraft({
      automationId: created.id,
      draftVersionId: draft.draftVersionId,
      currentVersion: draft.version,
      timezone: a.timezone,
      graph: a,
      snapshot,
      trigger: {
        sourceNodeId: "source",
        source: "callable",
        eventType: null,
        resourceId: null,
        reentry: "once",
        inactivityDays: null,
      },
    }),
  ).rejects.toThrow(/変更/);
  expect(
    await db.orm.select().from(automations).where(eq(automations.id, created.id)).get(),
  ).toMatchObject({
    status: "draft",
    draftVersionId: draft.draftVersionId,
    publishedVersionId: null,
  });
  const versions = await db.orm
    .select()
    .from(automationVersions)
    .where(eq(automationVersions.automationId, created.id));
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({ status: "draft", resolvedGraph: null, dependencies: "{}" });
  expect(JSON.parse(versions[0]!.graph)).toEqual(b);
  expect(
    await db.orm
      .select()
      .from(automationTriggers)
      .where(eq(automationTriggers.automationId, created.id)),
  ).toEqual([]);
  const published = await client.automations.publish({ id: created.id });
  const version = await db.orm
    .select()
    .from(automationVersions)
    .where(eq(automationVersions.id, published.publishedVersionId))
    .get();
  expect(JSON.parse(version!.resolvedGraph!)).toEqual({
    ...JSON.parse(version!.graph),
    variableProjectId: null,
  });
});

it("visits later schedule pages and only queues registration with a frozen scan time", async () => {
  const { workspaceId } = await seedWorkspaceClient(env.DB),
    db = createDatabase(env.DB),
    now = "2026-09-08T09:00:00.000Z";
  const ids: string[] = [];
  const schedules: AutomationSchedule[] = [
    { kind: "now" },
    { kind: "once", at: "2026-08-01T09:00:00.000Z" },
    { kind: "daily", hour: 9, minute: 0 },
    { kind: "daily", hour: 9, minute: 0 },
  ];
  for (const schedule of schedules) {
    const id = uuidv7(),
      versionId = uuidv7();
    ids.push(id);
    const definition = graph([
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
          schedule,
        },
      },
    ]);
    await db.orm.batch([
      db.orm.insert(automations).values({
        id,
        workspaceId,
        name: "Scheduled",
        status: "active",
        publishedVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      }),
      db.orm.insert(automationVersions).values({
        id: versionId,
        workspaceId,
        automationId: id,
        version: 1,
        status: "published",
        graph: JSON.stringify(definition),
        publishedAt: "2026-09-01T00:00:00.000Z",
        createdAt: now,
      }),
    ]);
  }
  type Continuation = { kind: string; now?: string; afterAutomationId?: string };
  const sent: Continuation[] = [];
  const queue = {
    ...queueStub(),
    send: async (message: Continuation) => {
      sent.push(message);
    },
  } as Queue;
  await dispatchScheduledAutomationRuns(db, new Date(now), 1, queue);
  for (let i = 0; i < sent.length; i++) {
    const message = sent[i]!;
    if (message.kind === "automation_schedule") {
      await dispatchScheduledAutomationRuns(
        db,
        new Date(message.now!),
        1,
        queue,
        message.afterAutomationId,
      );
    }
  }
  expect(
    sent
      .filter((message) => message.kind === "automation_schedule")
      .every((message) => message.now === now),
  ).toBe(true);
  const repo = new AutomationRunRepository(db, { workspaceId });
  expect(await Promise.all(ids.map(async (id) => (await repo.listRuns(id)).length))).toEqual([
    0, 0, 1, 1,
  ]);
  await dispatchScheduledAutomationRuns(db, new Date(now), 1);
  expect(await Promise.all(ids.map(async (id) => (await repo.listRuns(id)).length))).toEqual([
    0, 0, 1, 1,
  ]);
});

it("resumes a successfully parked fifth-start delay and recovers already stranded waits", async () => {
  const delay = {
    id: "delay",
    type: "delay" as const,
    position: { x: 0, y: 0 },
    config: { mode: "relative" as const, minutes: 1 },
  };
  const seeded = await seedAutomationJob({
    status: "leased",
    attempts: 4,
    leaseId: "lease",
    leaseUntil: "2099-01-01T00:00:00.000Z",
    nodeId: "delay",
    graph: graph([delay]),
  });
  const db = createDatabase(env.DB),
    engine = new AutomationJobRepository(db),
    recovery = new AutomationJobRecoveryRepository(db);
  await processAutomationJob(seeded.jobId, "lease", runtimeWithJobsQueue(queueStub()));
  expect(
    await db.orm.select().from(automationJobs).where(eq(automationJobs.id, seeded.jobId)).get(),
  ).toMatchObject({ status: "pending", attempts: 0, leaseId: null });
  // Previously deployed parked jobs can already hold an exhausted start budget.
  await db.orm
    .update(automationJobs)
    .set({ attempts: 5 })
    .where(eq(automationJobs.id, seeded.jobId));
  await recovery.recoverExpiredJobs("2100-01-01T00:00:00.000Z");
  const [claim] = await engine.claimDueJobs(
    "2100-01-01T00:00:00.000Z",
    "2100-01-02T00:00:00.000Z",
    100,
    seeded.workspaceId,
  );
  expect(claim).toBeDefined();
  // A transient failure after wake uses the new phase's budget and remains retryable.
  await engine.startLeasedJob(seeded.jobId, claim!.leaseId, "2100-01-01T00:00:00.000Z");
  expect(
    await recovery.recordJobFailure(
      seeded.jobId,
      claim!.leaseId,
      "Transient resume failure",
      "2100-01-01T00:00:00.000Z",
      false,
    ),
  ).toBe("retry");
  await processAutomationJob(seeded.jobId, claim!.leaseId, runtimeWithJobsQueue(queueStub()));
  await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "succeeded", "completed");
});

it.each(["condition", "batch"] as const)(
  "rejects invalid shared filter resources and custom-field types in %s publication",
  async (placement) => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB),
      db = createDatabase(env.DB),
      now = new Date().toISOString();
    await db.orm.insert(customFieldDefinitions).values({
      id: uuidv7(),
      workspaceId,
      entityType: "contact",
      key: "budget",
      label: "Budget",
      dataType: "number",
      createdAt: now,
      updatedAt: now,
    });
    const filters: SegmentFilter[] = [
      { kind: "condition", field: "project_id", operator: "eq", value: "foreign-project" },
      {
        kind: "condition",
        field: "category_score",
        key: "foreign-category",
        operator: "gte",
        value: 10,
      },
      {
        kind: "condition",
        field: "custom_field",
        key: "budget",
        operator: "contains",
        value: "wrong-type",
      },
    ];
    for (const filter of filters) {
      const source =
        placement === "batch"
          ? {
              source: "batch" as const,
              reentry: "once" as const,
              schedule: { kind: "now" as const },
              audience: { kind: "filter" as const, filter },
            }
          : { source: "api_event" as const, reentry: "once" as const, eventName: "start" };
      const definition = graph(
        [
          { id: "source", type: "source", position: { x: 0, y: 0 }, config: source },
          ...(placement === "condition"
            ? [
                {
                  id: "filter",
                  type: "condition" as const,
                  position: { x: 1, y: 0 },
                  config: { filter },
                },
              ]
            : []),
        ],
        placement === "condition"
          ? [{ id: "edge", source: "source", target: "filter", branch: "next" }]
          : [],
      );
      const created = await client.automations.create(definition);
      await expect(client.automations.publish({ id: created.id })).rejects.toThrow();
    }
  },
);
