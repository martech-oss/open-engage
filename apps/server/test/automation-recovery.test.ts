import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationDefinition, AutomationNode } from "@openengage/core/automations";
import {
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
import { persistDeadLetter } from "../src/platform/maintenance-worker";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspace } from "./factory";

afterEach(() => vi.useRealTimers());

describe("automation job recovery", () => {
  it.each(["leased", "running"] as const)(
    "reclaims an expired %s job through a fresh lease",
    async (status) => {
      const seeded = await seedAutomationJob({
        status,
        attempts: 2,
        leaseId: `expired-${status}`,
        leaseUntil: "2000-01-01T00:00:00.000Z",
      });
      const published: unknown[] = [];

      await scheduled(
        createScheduledController({ cron: "* * * * *" }),
        runtimeWithJobsQueue(
          queueStub(async (messages) => {
            published.push(...messages.map((message) => message.body));
          }),
        ),
        createExecutionContext(),
      );

      expect(published).toEqual([
        expect.objectContaining({ kind: "automation_job", jobId: seeded.jobId }),
      ]);
      const job = await readJob(seeded.jobId);
      expect(job).toMatchObject({ status: "leased", attempts: 2 });
      expect(job?.leaseId).not.toBe(`expired-${status}`);
    },
  );

  it("fails an expired fifth-start job and its enrollment atomically", async () => {
    const seeded = await seedAutomationJob({
      status: "running",
      attempts: 5,
      leaseId: "expired-fifth-start",
      leaseUntil: "2000-01-01T00:00:00.000Z",
    });
    const published: unknown[] = [];

    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithJobsQueue(
        queueStub(async (messages) => {
          published.push(...messages);
        }),
      ),
      createExecutionContext(),
    );

    expect(published).toEqual([]);
    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
  });

  it("unleases every matching claim when queue publication fails", async () => {
    const first = await seedAutomationJob({ status: "pending" });
    const second = await seedAutomationJob({ status: "pending" });
    const publicationError = new Error("injected queue outage");

    await expect(
      scheduled(
        createScheduledController({ cron: "* * * * *" }),
        runtimeWithJobsQueue(
          queueStub(async () => {
            throw publicationError;
          }),
        ),
        createExecutionContext(),
      ),
    ).rejects.toBe(publicationError);

    for (const jobId of [first.jobId, second.jobId]) {
      expect(await readJob(jobId)).toMatchObject({
        status: "pending",
        leaseId: null,
        leaseUntil: null,
      });
    }
  });

  it("turns a permanent worker error into terminal job and enrollment state", async () => {
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "permanent-error-lease",
      nodeId: "missing-node",
    });

    await expect(
      processAutomationJob(
        seeded.jobId,
        "permanent-error-lease",
        runtimeWithJobsQueue(queueStub()),
      ),
    ).rejects.toThrow("Automation node missing-node is missing");

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
  });

  it("does not schedule a sixth start after the fifth start fails", async () => {
    const action: AutomationNode = {
      id: "score",
      type: "action",
      position: { x: 0, y: 0 },
      config: { action: "change_score", amount: 5 },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      attempts: 4,
      leaseId: "fifth-start-lease",
      nodeId: action.id,
      graph: graph([action]),
    });
    await env.DB.prepare(
      `CREATE TRIGGER inject_score_failure
       BEFORE UPDATE OF score ON contacts
       WHEN NEW.id = '${seeded.contactId}'
       BEGIN SELECT RAISE(FAIL, 'injected score failure'); END`,
    ).run();

    await expect(
      processAutomationJob(seeded.jobId, "fifth-start-lease", runtimeWithJobsQueue(queueStub())),
    ).resolves.toBeUndefined();

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
    expect(await readJob(seeded.jobId)).toMatchObject({ attempts: 5 });
  });

  it("fails the matching job and enrollment when its queue message reaches the DLQ", async () => {
    expect.hasAssertions();
    const seeded = await seedAutomationJob({
      status: "leased",
      attempts: 3,
      leaseId: "dead-letter-lease",
    });

    await persistDeadLetter(
      "openengage-dead-letter",
      { kind: "automation_job", jobId: seeded.jobId, leaseId: "dead-letter-lease" },
      5,
      runtimeWithJobsQueue(queueStub()),
    );

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
  });

  it("does not let a stale dead-letter message fail a newer lease", async () => {
    expect.hasAssertions();
    const seeded = await seedAutomationJob({
      status: "leased",
      attempts: 3,
      leaseId: "newer-lease",
    });

    await persistDeadLetter(
      "openengage-dead-letter",
      { kind: "automation_job", jobId: seeded.jobId, leaseId: "stale-lease" },
      5,
      runtimeWithJobsQueue(queueStub()),
    );

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "leased", "active");
  });

  it("does not double-apply change_score when completion fails after the mutation", async () => {
    const action: AutomationNode = {
      id: "score-once",
      type: "action",
      position: { x: 0, y: 0 },
      config: { action: "change_score", amount: 7 },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "score-effect-lease",
      nodeId: action.id,
      graph: graph([action]),
    });
    await env.DB.prepare(
      `CREATE TRIGGER inject_completion_failure
       BEFORE UPDATE OF status ON automation_jobs
       WHEN OLD.id = '${seeded.jobId}' AND NEW.status = 'succeeded'
       BEGIN SELECT RAISE(FAIL, 'injected completion failure'); END`,
    ).run();

    await expect(
      processAutomationJob(seeded.jobId, "score-effect-lease", runtimeWithJobsQueue(queueStub())),
    ).rejects.toThrow("injected completion failure");
    await env.DB.prepare("DROP TRIGGER inject_completion_failure").run();

    await processAutomationJob(
      seeded.jobId,
      "score-effect-lease",
      runtimeWithJobsQueue(queueStub()),
    );

    const effect = await env.DB.prepare(
      `SELECT c.score,
              (SELECT COUNT(*) FROM score_events se WHERE se.contact_id = c.id) AS scoreEvents
       FROM contacts c WHERE c.id = ?`,
    )
      .bind(seeded.contactId)
      .first<{ score: number; scoreEvents: number }>();
    expect(effect).toEqual({ score: 7, scoreEvents: 1 });
  });
});

describe("decision node recovery", () => {
  it("ignores a matching event that happened before the decision job was created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:03:00.000Z"));
    const decision = decisionNode({ resourceId: "delivery-1", withinMinutes: 10 });
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "pre-node-event-lease",
      nodeId: decision.id,
      graph: graph([decision]),
      enteredAt: "2026-08-20T10:00:00.000Z",
      createdAt: "2026-08-20T10:02:00.000Z",
    });
    await processAutomationJob(
      seeded.jobId,
      "pre-node-event-lease",
      runtimeWithJobsQueue(queueStub()),
    );
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: seeded.workspaceId,
      contactId: seeded.contactId,
      type: "email_opened",
      resourceType: "delivery",
      resourceId: "delivery-1",
      occurredAt: "2026-08-20T10:01:00.000Z",
      queue: queueStub(),
    });

    expect(await readJob(seeded.jobId)).toMatchObject({
      status: "pending",
      dueAt: "2026-08-20T10:12:00.000Z",
    });
  });

  it("wakes a parked wait promptly when a matching event arrives, with null resource matching any", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T11:01:00.000Z"));
    const decision = decisionNode({ withinMinutes: 30 });
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "waiting-lease",
      nodeId: decision.id,
      graph: graph([decision]),
      enteredAt: "2026-08-20T11:00:00.000Z",
      createdAt: "2026-08-20T11:00:00.000Z",
    });
    await processAutomationJob(seeded.jobId, "waiting-lease", runtimeWithJobsQueue(queueStub()));

    vi.setSystemTime(new Date("2026-08-20T11:02:00.000Z"));
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: seeded.workspaceId,
      contactId: seeded.contactId,
      type: "email_opened",
      resourceType: "delivery",
      resourceId: "any-delivery",
      occurredAt: "2026-08-20T11:01:30.000Z",
      queue: queueStub(),
    });

    expect(await readJob(seeded.jobId)).toMatchObject({
      status: "pending",
      dueAt: "2026-08-20T11:02:00.000Z",
    });
  });

  it("takes the timeout branch at the withinMinutes deadline measured from job creation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:01:00.000Z"));
    const decision = decisionNode({ withinMinutes: 10 });
    const timeout: AutomationNode = {
      id: "timeout-action",
      type: "action",
      position: { x: 200, y: 0 },
      config: { action: "change_score", amount: -1 },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "deadline-lease",
      nodeId: decision.id,
      graph: graph(
        [decision, timeout],
        [
          {
            id: "decision-timeout",
            source: decision.id,
            target: timeout.id,
            branch: "timeout",
          },
        ],
      ),
      enteredAt: "2026-08-20T12:00:00.000Z",
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    await processAutomationJob(seeded.jobId, "deadline-lease", runtimeWithJobsQueue(queueStub()));

    vi.setSystemTime(new Date("2026-08-20T12:10:00.000Z"));
    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithJobsQueue(queueStub()),
      createExecutionContext(),
    );
    const claimed = await env.DB.prepare(
      "SELECT id, lease_id AS leaseId FROM automation_jobs WHERE enrollment_id = ? AND node_id = ? AND status = 'leased'",
    )
      .bind(seeded.enrollmentId, decision.id)
      .first<{ id: string; leaseId: string }>();
    if (!claimed) throw new Error("decision job was not claimed at its deadline");
    await processAutomationJob(claimed.id, claimed.leaseId, runtimeWithJobsQueue(queueStub()));

    const next = await env.DB.prepare(
      "SELECT node_id AS nodeId, status FROM automation_jobs WHERE enrollment_id = ? AND node_id = ?",
    )
      .bind(seeded.enrollmentId, timeout.id)
      .first<{ nodeId: string; status: string }>();
    expect(next).toEqual({ nodeId: timeout.id, status: "pending" });
  });

  it("stores indexed event and resource keys while a decision wait is parked", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info('automation_jobs')").all<{
      name: string;
    }>();
    const indexes = await env.DB.prepare("PRAGMA index_list('automation_jobs')").all<{
      name: string;
    }>();

    expect(columns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining(["wait_event_type", "wait_resource_id"]),
    );
    expect(indexes.results.map((index) => index.name)).toContain("automation_jobs_wait_event_idx");
  });
});

async function seedAutomationJob(input: {
  status: "pending" | "leased" | "running";
  attempts?: number;
  leaseId?: string | null;
  leaseUntil?: string | null;
  nodeId?: string;
  graph?: AutomationDefinition;
  enteredAt?: string;
  createdAt?: string;
  dueAt?: string;
}) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contactId = uuidv7();
  const automationId = uuidv7();
  const automationVersionId = uuidv7();
  const enrollmentId = uuidv7();
  const jobId = uuidv7();
  const createdAt = input.createdAt ?? "2026-08-20T00:00:00.000Z";
  const enteredAt = input.enteredAt ?? createdAt;
  const nodeId = input.nodeId ?? "source";
  const definition =
    input.graph ??
    graph([
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "contact_created", reentry: "once" },
      },
    ]);
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email: `${contactId}@example.com`,
      status: "active",
      customFields: "{}",
      createdAt,
      updatedAt: createdAt,
    }),
    orm.insert(automations).values({
      id: automationId,
      workspaceId,
      name: "Recovery fixture",
      status: "active",
      publishedVersionId: automationVersionId,
      createdAt,
      updatedAt: createdAt,
    }),
    orm.insert(automationVersions).values({
      id: automationVersionId,
      workspaceId,
      automationId,
      version: 1,
      status: "published",
      timezone: "UTC",
      graph: JSON.stringify(definition),
      publishedAt: createdAt,
      createdAt,
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
      enteredAt,
      updatedAt: enteredAt,
    }),
    orm.insert(automationJobs).values({
      id: jobId,
      workspaceId,
      enrollmentId,
      automationVersionId,
      nodeId,
      contactId,
      idempotencyKey: `${enrollmentId}:${nodeId}:${contactId}`,
      status: input.status,
      dueAt: input.dueAt ?? "2000-01-01T00:00:00.000Z",
      leaseId: input.leaseId ?? null,
      leaseUntil: input.leaseUntil ?? null,
      attempts: input.attempts ?? 0,
      createdAt,
      updatedAt: createdAt,
    }),
  ]);
  return { workspaceId, contactId, enrollmentId, jobId };
}

function graph(
  nodes: AutomationDefinition["nodes"],
  edges: AutomationDefinition["edges"] = [],
): AutomationDefinition {
  return {
    name: "Recovery fixture",
    description: "",
    timezone: "UTC",
    nodes,
    edges,
  };
}

function decisionNode(input: {
  resourceId?: string;
  withinMinutes: number;
}): Extract<AutomationNode, { type: "decision" }> {
  return {
    id: "decision",
    type: "decision",
    position: { x: 0, y: 0 },
    config: {
      event: "opened",
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      withinMinutes: input.withinMinutes,
    },
  };
}

function queueStub(
  sendBatch: (messages: Iterable<MessageSendRequest<unknown>>) => Promise<void> = async () => {},
): Queue {
  return {
    send: async () => {},
    sendBatch,
  } as unknown as Queue;
}

function runtimeWithJobsQueue(queue: Queue): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return queue;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

async function readJob(jobId: string): Promise<{
  status: string;
  attempts: number;
  dueAt: string;
  leaseId: string | null;
  leaseUntil: string | null;
} | null> {
  return (
    (await createDatabase(env.DB)
      .orm.select({
        status: automationJobs.status,
        attempts: automationJobs.attempts,
        dueAt: automationJobs.dueAt,
        leaseId: automationJobs.leaseId,
        leaseUntil: automationJobs.leaseUntil,
      })
      .from(automationJobs)
      .where(eq(automationJobs.id, jobId))
      .get()) ?? null
  );
}

async function expectJobAndEnrollment(
  jobId: string,
  enrollmentId: string,
  jobStatus: string,
  enrollmentStatus: string,
): Promise<void> {
  const row = await createDatabase(env.DB)
    .orm.select({
      jobStatus: automationJobs.status,
      enrollmentStatus: automationEnrollments.status,
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
  expect(row).toEqual({ jobStatus, enrollmentStatus });
}
