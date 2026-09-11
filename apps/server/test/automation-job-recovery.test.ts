import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationNode } from "@openengage/core/automations";
import {
  AutomationActionRepository,
  AutomationJobRecoveryRepository,
  createDatabase,
  MessagingDeliveryWriteRepository,
  uuidv7,
} from "@openengage/database/testing";

import { processAutomationJob } from "../src/automations/worker";
import { persistDeadLetter } from "../src/platform/maintenance-worker";
import { scheduled } from "../src/runtime/dispatch";
import {
  expectJobAndEnrollment,
  graph,
  queueStub,
  readJob,
  runtimeWithJobsQueue,
  seedAutomationJob,
} from "./automation-recovery-test-support";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it("blocks a paused fifth-start worker from applying change_score after recovery fails it", async () => {
    const action: AutomationNode = {
      id: "stale-score",
      type: "action",
      position: { x: 0, y: 0 },
      config: { action: "change_score", amount: 5 },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      attempts: 4,
      leaseId: "stale-action-lease",
      leaseUntil: "2000-01-01T00:00:00.000Z",
      nodeId: action.id,
      graph: graph([action]),
    });
    const originalRepository = new AutomationActionRepository(createDatabase(env.DB));
    const originalAdjust = originalRepository.adjustContactScoreForJob.bind(originalRepository);
    let releaseAction!: () => void;
    let announceAction!: () => void;
    const actionReleased = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const actionObserved = new Promise<void>((resolve) => {
      announceAction = resolve;
    });
    vi.spyOn(AutomationActionRepository.prototype, "adjustContactScoreForJob").mockImplementation(
      async (...args) => {
        announceAction();
        await actionReleased;
        return originalAdjust(...args);
      },
    );
    const reconciliationMessages: unknown[] = [];
    const processing = processAutomationJob(
      seeded.jobId,
      "stale-action-lease",
      runtimeWithJobsQueue(
        queueStub(async (messages) => {
          reconciliationMessages.push(...[...messages].map((message) => message.body));
        }),
      ),
    );

    await actionObserved;
    await new AutomationJobRecoveryRepository(createDatabase(env.DB)).recoverExpiredJobs(
      "2026-08-20T05:30:00.000Z",
    );
    releaseAction();
    await processing;

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
    const effects = await env.DB.prepare(
      `SELECT c.score,
              (SELECT COUNT(*) FROM score_events se
               WHERE se.contact_id = c.id) AS scoreEvents,
              (SELECT COUNT(*) FROM automation_action_effects aae
               WHERE aae.job_id = ?) AS actionEffects,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.enrollment_id = ?) AS deliveries
       FROM contacts c WHERE c.id = ?`,
    )
      .bind(seeded.jobId, seeded.enrollmentId, seeded.contactId)
      .first<{
        score: number;
        scoreEvents: number;
        actionEffects: number;
        deliveries: number;
      }>();
    expect.soft(effects).toEqual({ score: 0, scoreEvents: 0, actionEffects: 0, deliveries: 0 });
    expect.soft(reconciliationMessages).toEqual([]);
  });

  it("blocks a paused fifth-start worker from creating a webhook delivery after recovery fails it", async () => {
    const endpointId = uuidv7();
    const action: AutomationNode = {
      id: "stale-webhook",
      type: "action",
      position: { x: 0, y: 0 },
      config: { action: "send_webhook", endpointId },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      attempts: 4,
      leaseId: "stale-delivery-lease",
      leaseUntil: "2000-01-01T00:00:00.000Z",
      nodeId: action.id,
      graph: graph([action]),
    });
    await env.DB.prepare(
      `INSERT INTO webhook_endpoints
         (id, workspace_id, name, url, encrypted_secret, enabled, created_at, updated_at)
       VALUES (?, ?, 'Stale endpoint', 'https://example.com/hook', 'unused', 1,
               '2026-08-20T05:40:00.000Z', '2026-08-20T05:40:00.000Z')`,
    )
      .bind(endpointId, seeded.workspaceId)
      .run();

    const originalRepository = new MessagingDeliveryWriteRepository(createDatabase(env.DB));
    const originalInsert = originalRepository.insertQueuedDelivery.bind(originalRepository);
    let releaseInsert!: () => void;
    let announceInsert!: () => void;
    const insertReleased = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const insertObserved = new Promise<void>((resolve) => {
      announceInsert = resolve;
    });
    vi.spyOn(MessagingDeliveryWriteRepository.prototype, "insertQueuedDelivery").mockImplementation(
      async (...args) => {
        announceInsert();
        await insertReleased;
        return originalInsert(...args);
      },
    );
    const jobMessages: unknown[] = [];
    const deliveryMessages: unknown[] = [];
    const jobsQueue = recordingQueue(jobMessages);
    const deliveryQueue = recordingQueue(deliveryMessages);
    const processing = processAutomationJob(
      seeded.jobId,
      "stale-delivery-lease",
      runtimeWithQueues(jobsQueue, deliveryQueue),
    );

    await insertObserved;
    await new AutomationJobRecoveryRepository(createDatabase(env.DB)).recoverExpiredJobs(
      "2026-08-20T05:45:00.000Z",
    );
    releaseInsert();
    await processing;

    await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
    const deliveries = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM deliveries WHERE enrollment_id = ?",
    )
      .bind(seeded.enrollmentId)
      .first<{ count: number }>();
    expect.soft(deliveries).toEqual({ count: 0 });
    expect.soft(deliveryMessages).toEqual([]);
    expect.soft(jobMessages).toEqual([]);
  });
});

function recordingQueue(messages: unknown[]): Queue {
  return {
    send: async (body: unknown) => {
      messages.push(body);
    },
    sendBatch: async (batch: Iterable<MessageSendRequest<unknown>>) => {
      messages.push(...[...batch].map((message) => message.body));
    },
  } as unknown as Queue;
}

function runtimeWithQueues(jobsQueue: Queue, deliveryQueue: Queue) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return jobsQueue;
      if (property === "DELIVERY_QUEUE") return deliveryQueue;
      return Reflect.get(target, property, receiver);
    },
  });
}
