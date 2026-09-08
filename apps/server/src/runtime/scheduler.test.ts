import { describe, expect, it } from "vitest";

import { publishQueueBatches } from "../platform/queue-publisher";
import { dispatchDueAutomationJobs, runScheduledTasks } from "./scheduler";

describe("bounded queue publication", () => {
  it.each([100, 101, 1000])(
    "publishes %i messages without exceeding Queue limits",
    async (count) => {
      const published: number[][] = [];
      await publishQueueBatches(
        {
          sendBatch: async (batch) => {
            const values = Array.from(batch);
            if (values.length > 100) throw new Error("Queue batch too large");
            published.push(values.map((message) => message.body.id));
          },
        },
        Array.from({ length: count }, (_, id) => ({ body: { id } })),
      );
      expect(published.flat()).toEqual(Array.from({ length: count }, (_, id) => id));
      expect(published).toHaveLength(Math.ceil(count / 100));
    },
  );

  it("bounds encoded Unicode bytes as well as message count", async () => {
    const sizes: number[] = [];
    await publishQueueBatches(
      {
        sendBatch: async (batch) => {
          const bytes = Array.from(batch).reduce(
            (sum, message) =>
              sum + new TextEncoder().encode(JSON.stringify(message.body)).length + 100,
            0,
          );
          if (bytes > 256_000) throw new Error("Queue bytes exceeded");
          sizes.push(bytes);
        },
      },
      Array.from({ length: 4 }, () => ({ body: { text: "あ".repeat(30_000) } })),
    );
    expect(sizes).toHaveLength(2);
  });

  it("rejects oversized messages before publishing any earlier messages", async () => {
    const published: unknown[] = [];
    await expect(
      publishQueueBatches(
        {
          sendBatch: async (batch) => {
            published.push(...batch);
          },
        },
        [{ body: "small" }, { body: "x".repeat(128_000) }],
      ),
    ).rejects.toThrow(/message/i);
    expect(published).toEqual([]);
  });
});

describe("scheduled domain tasks", () => {
  it("runs later tasks after failure and reports all failures", async () => {
    const effects: string[] = [];
    const first = new Error("first"),
      second = new Error("second");
    await expect(
      runScheduledTasks(
        [
          {
            name: "first",
            run: async () => {
              throw first;
            },
          },
          {
            name: "delivery",
            run: async () => {
              effects.push("delivery recovered");
            },
          },
          {
            name: "second",
            run: async () => {
              throw second;
            },
          },
        ],
        () => {},
      ),
    ).rejects.toMatchObject({ errors: [first, second] });
    expect(effects).toEqual(["delivery recovered"]);
  });

  it("retains published leases and returns only unpublished claims after partial failure", async () => {
    const claims = Array.from({ length: 120 }, (_, id) => ({
      id: String(id),
      leaseId: `lease-${id}`,
    }));
    const pending: string[] = [],
      published: string[] = [];
    let calls = 0;
    const failure = new Error("Queue unavailable");
    await expect(
      dispatchDueAutomationJobs(
        {
          recoverExpiredJobs: async () => {},
          workspacesWithDueJobs: async () =>
            Array.from({ length: 6 }, (_, id) => ({ workspaceId: String(id) })),
          claimDueJobs: async (_now, _leaseUntil, _limit, workspaceId) =>
            claims.slice(Number(workspaceId) * 20, Number(workspaceId) * 20 + 20),
          returnClaimsToPending: async (rows) => {
            pending.push(...rows.map((row) => row.id));
          },
          queue: {
            sendBatch: async (batch) => {
              if (++calls === 2) throw failure;
              published.push(...Array.from(batch, (message) => message.body.jobId));
            },
          },
        },
        new Date("2026-09-08T00:00:00Z"),
      ),
    ).rejects.toBe(failure);
    expect(published).toHaveLength(100);
    expect(pending).toEqual(Array.from({ length: 20 }, (_, id) => String(100 + id)));
  });
});
