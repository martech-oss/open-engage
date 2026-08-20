import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationDefinition, AutomationNode } from "@openengage/core/automations";
import {
  AutomationEngineRepository,
  AutomationJobRecoveryRepository,
  automationEnrollments,
  automationJobs,
  automations,
  automationVersions,
  contacts,
  createDatabase,
  uuidv7,
} from "@openengage/database/testing";

import { processAutomationJob } from "../src/automations/worker";
import { recordContactEvent } from "../src/contacts/event-service";
import type { RuntimeEnv } from "../src/env";
import { seedWorkspace } from "./factory";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("automation stale completion races", () => {
  it("keeps an attempt-five recovery failed when the expired lease reports terminal completion", async () => {
    const seeded = await seedRunningJob({ attempts: 5, leaseId: "expired-terminal-lease" });
    const database = createDatabase(env.DB);
    const recovery = new AutomationJobRecoveryRepository(database);
    const engine = new AutomationEngineRepository(database);

    await recovery.recoverExpiredJobs("2026-08-20T01:00:00.000Z");
    await engine.completeJobClosingEnrollment(
      {
        id: seeded.jobId,
        workspaceId: seeded.workspaceId,
        enrollmentId: seeded.enrollmentId,
      },
      "expired-terminal-lease",
      "2026-08-20T01:00:01.000Z",
    );

    expect(await readState(seeded.jobId, seeded.enrollmentId)).toEqual({
      jobStatus: "failed",
      enrollmentStatus: "failed",
      currentNodeId: null,
      leaseId: null,
    });
  });

  it("does not advance an enrollment when an expired lease completes after a fresh claim", async () => {
    const seeded = await seedRunningJob({ attempts: 2, leaseId: "expired-advancing-lease" });
    const database = createDatabase(env.DB);
    const recovery = new AutomationJobRecoveryRepository(database);
    const engine = new AutomationEngineRepository(database);

    await recovery.recoverExpiredJobs("2026-08-20T01:00:00.000Z");
    const claims = await engine.claimDueJobs(
      "2026-08-20T01:00:00.000Z",
      "2026-08-20T01:05:00.000Z",
      10,
      seeded.workspaceId,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.leaseId).not.toBe("expired-advancing-lease");

    await engine.completeJobAdvancingEnrollment(
      {
        id: seeded.jobId,
        workspaceId: seeded.workspaceId,
        enrollmentId: seeded.enrollmentId,
        automationVersionId: seeded.automationVersionId,
        contactId: seeded.contactId,
      },
      "expired-advancing-lease",
      "next-node",
      "2026-08-20T01:00:01.000Z",
    );

    const state = await readState(seeded.jobId, seeded.enrollmentId);
    expect(state).toEqual({
      jobStatus: "leased",
      enrollmentStatus: "active",
      currentNodeId: "source",
      leaseId: claims[0]?.leaseId,
    });
    const nextJobs = await database.orm
      .select({ id: automationJobs.id })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.enrollmentId, seeded.enrollmentId),
          eq(automationJobs.nodeId, "next-node"),
        ),
      );
    expect(nextJobs).toEqual([]);
  });

  it("parks a decision due-now when its matching event projects between check and park", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T02:02:00.000Z"));
    const decision: AutomationNode = {
      id: "decision",
      type: "decision",
      position: { x: 0, y: 0 },
      config: { event: "opened", withinMinutes: 30 },
    };
    const graph: AutomationDefinition = {
      name: "Decision barrier fixture",
      description: "",
      timezone: "UTC",
      nodes: [decision],
      edges: [],
    };
    const seeded = await seedRunningJob({
      attempts: 1,
      leaseId: "decision-barrier-lease",
      leaseUntil: "2026-08-20T02:05:00.000Z",
      nodeId: decision.id,
      graph,
      createdAt: "2026-08-20T02:00:00.000Z",
    });
    const originalRepository = new AutomationEngineRepository(createDatabase(env.DB));
    const originalCheck = originalRepository.hasContactEventSince.bind(originalRepository);
    let injected = false;
    vi.spyOn(AutomationEngineRepository.prototype, "hasContactEventSince").mockImplementation(
      async function (workspaceId, contactId, type, since, resourceId) {
        const found = await originalCheck(workspaceId, contactId, type, since, resourceId);
        if (!found && !injected) {
          injected = true;
          await recordContactEvent(createDatabase(env.DB), {
            workspaceId: seeded.workspaceId,
            contactId: seeded.contactId,
            type: "email_opened",
            resourceType: "delivery",
            resourceId: "delivery-while-parking",
            occurredAt: "2026-08-20T02:01:00.000Z",
            queue: queueStub(),
          });
        }
        return found;
      },
    );

    await processAutomationJob(
      seeded.jobId,
      "decision-barrier-lease",
      runtimeWithJobsQueue(queueStub()),
    );

    expect(await readJobDueAt(seeded.jobId)).toEqual({
      status: "pending",
      dueAt: "2026-08-20T02:02:00.000Z",
    });
  });
});

async function seedRunningJob(input: {
  attempts: number;
  leaseId: string;
  leaseUntil?: string;
  nodeId?: string;
  graph?: AutomationDefinition;
  createdAt?: string;
}) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contactId = uuidv7();
  const automationId = uuidv7();
  const automationVersionId = uuidv7();
  const enrollmentId = uuidv7();
  const jobId = uuidv7();
  const now = input.createdAt ?? "2026-08-20T00:00:00.000Z";
  const nodeId = input.nodeId ?? "source";
  const graph: AutomationDefinition =
    input.graph ??
    ({
      name: "Completion race fixture",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
      ],
      edges: [],
    } satisfies AutomationDefinition);
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email: `${contactId}@example.com`,
      status: "active",
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(automations).values({
      id: automationId,
      workspaceId,
      name: "Completion race fixture",
      status: "active",
      publishedVersionId: automationVersionId,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(automationVersions).values({
      id: automationVersionId,
      workspaceId,
      automationId,
      version: 1,
      status: "published",
      timezone: "UTC",
      graph: JSON.stringify(graph),
      publishedAt: now,
      createdAt: now,
    }),
  ]);
  await orm.batch([
    orm.insert(automationEnrollments).values({
      id: enrollmentId,
      workspaceId,
      automationId,
      automationVersionId,
      contactId,
      sourceEventId: uuidv7(),
      status: "active",
      currentNodeId: nodeId,
      enteredAt: now,
      updatedAt: now,
    }),
    orm.insert(automationJobs).values({
      id: jobId,
      workspaceId,
      enrollmentId,
      automationVersionId,
      nodeId,
      contactId,
      idempotencyKey: `${enrollmentId}:${nodeId}:${contactId}`,
      status: "running",
      dueAt: now,
      leaseId: input.leaseId,
      leaseUntil: input.leaseUntil ?? "2000-01-01T00:00:00.000Z",
      attempts: input.attempts,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return { workspaceId, contactId, automationVersionId, enrollmentId, jobId };
}

async function readJobDueAt(jobId: string) {
  return await createDatabase(env.DB)
    .orm.select({ status: automationJobs.status, dueAt: automationJobs.dueAt })
    .from(automationJobs)
    .where(eq(automationJobs.id, jobId))
    .get();
}

function queueStub(): Queue {
  return { send: async () => {}, sendBatch: async () => {} } as unknown as Queue;
}

function runtimeWithJobsQueue(queue: Queue): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return queue;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

async function readState(jobId: string, enrollmentId: string) {
  return await createDatabase(env.DB)
    .orm.select({
      jobStatus: automationJobs.status,
      enrollmentStatus: automationEnrollments.status,
      currentNodeId: automationEnrollments.currentNodeId,
      leaseId: automationJobs.leaseId,
    })
    .from(automationJobs)
    .innerJoin(
      automationEnrollments,
      and(
        eq(automationEnrollments.id, automationJobs.enrollmentId),
        eq(automationEnrollments.id, enrollmentId),
      ),
    )
    .where(eq(automationJobs.id, jobId))
    .get();
}
