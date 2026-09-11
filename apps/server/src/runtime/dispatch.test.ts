import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../env";
import { jobsQueueHandlers, queue } from "./dispatch";

afterEach(() => vi.restoreAllMocks());

interface TestMessage {
  id: string;
  body: unknown;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function message(id: string): TestMessage {
  return {
    id,
    body: { kind: "contact_event", eventId: id },
    attempts: 1,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: QueueRetryOptions) => void>(),
  };
}

function batch(messages: TestMessage[]): MessageBatch<unknown> {
  return { queue: "openengage-jobs", messages } as unknown as MessageBatch<unknown>;
}

describe("jobs queue dispatch", () => {
  it("dispatches at most five messages concurrently", async () => {
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    let releaseFirstWave!: () => void;
    let reportFirstWave!: () => void;
    const firstWaveStarted = new Promise<void>((resolve) => {
      reportFirstWave = resolve;
    });
    const firstWaveGate = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    const handler = vi.spyOn(jobsQueueHandlers, "contact_event").mockImplementation(async () => {
      active += 1;
      started += 1;
      maximumActive = Math.max(maximumActive, active);
      if (started === 5) reportFirstWave();
      await firstWaveGate;
      active -= 1;
    });
    const messages = Array.from({ length: 12 }, (_, index) => message(`event-${index}`));

    const processing = queue(batch(messages), {} as RuntimeEnv);
    await firstWaveStarted;

    expect(started).toBe(5);
    expect(maximumActive).toBe(5);
    releaseFirstWave();
    await processing;

    expect(handler).toHaveBeenCalledTimes(12);
    expect(maximumActive).toBeLessThanOrEqual(5);
    expect(messages.every((item) => item.ack.mock.calls.length === 1)).toBe(true);
    handler.mockRestore();
  });

  it("acks a successful message while retrying an independently failed message", async () => {
    const handler = vi
      .spyOn(jobsQueueHandlers, "contact_event")
      .mockImplementation(async (item) => {
        if (item.eventId === "failed") throw new Error("projection failed");
      });
    const successful = message("successful");
    const failed = message("failed");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await queue(batch([failed, successful]), {} as RuntimeEnv);

    expect(successful.ack).toHaveBeenCalledOnce();
    expect(successful.retry).not.toHaveBeenCalled();
    expect(failed.ack).not.toHaveBeenCalled();
    expect(failed.retry).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      event: "queue.message_failed",
      context: { queue: "openengage-jobs", messageId: "failed", attempts: 1 },
      error: { message: "projection failed" },
    });
    errorLog.mockRestore();
    handler.mockRestore();
  });
});
