import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { createDatabase, deadLetters } from "@openengage/database/testing";

import { queue } from "../src/runtime/dispatch";
import {
  expectJobAndEnrollment,
  queueStub,
  runtimeWithJobsQueue,
  seedAutomationJob,
} from "./automation-recovery-test-support";

afterEach(() => vi.restoreAllMocks());

function automationMessage(jobId: string) {
  const message = {
    id: "automation-message",
    body: { kind: "automation_job", jobId, leaseId: "dispatch-lease" },
    attempts: 1,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: QueueRetryOptions) => void>(),
  };
  return {
    message,
    batch: { queue: "openengage-jobs", messages: [message] } as unknown as MessageBatch<unknown>,
  };
}

it("composes real automation execution from a jobs queue message and acknowledges completion", async () => {
  const seeded = await seedAutomationJob({ status: "leased", leaseId: "dispatch-lease" });
  const { message, batch } = automationMessage(seeded.jobId);

  await queue(batch, runtimeWithJobsQueue(queueStub()));

  await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "succeeded", "completed");
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
});

it("keeps permanent automation failures recognizable by queue dead-letter dispatch", async () => {
  const seeded = await seedAutomationJob({
    status: "leased",
    leaseId: "dispatch-lease",
    nodeId: "missing",
  });
  const { message, batch } = automationMessage(seeded.jobId);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  await queue(batch, runtimeWithJobsQueue(queueStub()));

  await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "failed", "failed");
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
  expect(errorLog).toHaveBeenCalledOnce();
  expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
    event: "queue.message_failed",
    error: { message: "Automation node missing is missing" },
  });
  const deadLetter = await createDatabase(env.DB)
    .orm.select()
    .from(deadLetters)
    .where(eq(deadLetters.workspaceId, seeded.workspaceId))
    .get();
  expect(deadLetter).toMatchObject({
    sourceQueue: "openengage-jobs",
    attempts: 1,
    error: "Automation node missing is missing",
    messageBody: JSON.stringify(message.body),
  });
});
