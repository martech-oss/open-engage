import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";

import { ScoringDecayRepository } from "@openengage/database/scoring";
import { contacts, createDatabase, scoreContributions, uuidv7 } from "@openengage/database/testing";

import { queue as dispatchQueue } from "../src/runtime/dispatch";
import { runScoringDecay } from "../src/scoring/decay-service";
import { runtimeWithJobsQueue } from "./automation-recovery-test-support";
import { seedWorkspace } from "./factory";

const occurredAt = "2026-09-09T00:00:00.000Z";
const now = new Date("2026-09-10T00:00:00.000Z");

async function seed(count: number) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contactId = uuidv7();
  const database = createDatabase(env.DB);
  await database.orm.insert(contacts).values({
    id: contactId,
    workspaceId,
    email: `${contactId}@example.com`,
    status: "active",
    score: count * 20,
    customFields: "{}",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  // Separate inserts stay within D1's parameter limit while preparing a multi-page backlog.
  for (let i = 0; i < count; i++) {
    await database.orm.insert(scoreContributions).values({
      id: uuidv7(),
      workspaceId,
      contactId,
      ruleId: "decaying-rule",
      initialScore: 20,
      remainingScore: 20,
      decayDays: 2,
      occurredAt,
      nextDecayAt: now.toISOString(),
    });
  }
  const continuations: unknown[] = [];
  const projections: unknown[] = [];
  const queue = {
    send: async (message: unknown) => {
      continuations.push(message);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
      projections.push(...Array.from(messages, (message) => message.body));
    },
  } as unknown as Queue;
  const score = async () => {
    const row = await env.DB.prepare("SELECT score FROM contacts WHERE id=?")
      .bind(contactId)
      .first<{ score: number }>();
    return row?.score;
  };
  return { database, contactId, continuations, projections, queue, score };
}

async function consume(body: unknown, queue: Queue) {
  const ack = vi.fn<() => void>();
  const retry = vi.fn<(options?: QueueRetryOptions) => void>();
  await dispatchQueue(
    {
      queue: "openengage-jobs",
      messages: [{ id: uuidv7(), body, attempts: 1, ack, retry }],
    } as unknown as MessageBatch,
    runtimeWithJobsQueue(queue),
  );
  expect(ack).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
}

it("drains multiple decay pages through the jobs queue without another cron or advancing the cutoff", async () => {
  const f = await seed(45);
  await runScoringDecay(f.database, f.queue, now);
  expect(await f.score()).toBe(700);
  expect(f.continuations).toEqual([{ kind: "scoring_decay", now: now.toISOString() }]);
  const firstContinuation = f.continuations[0];
  let consumed = 0;
  while (f.continuations.length) {
    expect(++consumed).toBeLessThanOrEqual(3);
    await consume(f.continuations.shift(), f.queue);
  }
  expect(consumed).toBe(2);
  expect(await f.score()).toBe(450);
  expect(await new ScoringDecayRepository(f.database).listDue(now.toISOString(), 1)).toEqual([]);
  expect(f.projections).toHaveLength(45);
  expect(f.projections).toEqual(
    Array(45).fill(
      expect.objectContaining({
        kind: "segment_contact_reconcile",
        contactId: f.contactId,
      }),
    ),
  );
  // Replayed queue messages must not decay the next day's contributions or repeat side effects.
  await consume(firstContinuation, f.queue);
  expect(await f.score()).toBe(450);
  expect(f.continuations).toHaveLength(0);
  expect(f.projections).toHaveLength(45);
  const history = await env.DB.prepare(
    "SELECT count(*) AS count FROM score_events WHERE contact_id=?",
  )
    .bind(f.contactId)
    .first<{ count: number }>();
  expect(history?.count).toBe(45);
});

it("leaves unpublished continuation work recoverable by the next cron without double decay", async () => {
  const f = await seed(21);
  const unavailableQueue = {
    sendBatch: f.queue.sendBatch,
    send: async () => {
      throw new Error("Queue unavailable");
    },
  } as unknown as Queue;
  await expect(runScoringDecay(f.database, unavailableQueue, now)).rejects.toThrow(
    "Queue unavailable",
  );
  expect(await f.score()).toBe(220);
  await runScoringDecay(f.database, f.queue, now);
  expect(await f.score()).toBe(210);
  expect(f.continuations).toHaveLength(0);
  expect(f.projections).toHaveLength(21);
});
