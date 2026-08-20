import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationNode } from "@openengage/core/automations";

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
