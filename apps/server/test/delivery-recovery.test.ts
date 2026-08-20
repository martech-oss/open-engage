import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  DeliveryRecoveryRepository,
  deliveries,
  deliveryEvents,
  uuidv7,
  webhookEndpoints,
} from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { processDelivery } from "../src/messaging/delivery-worker";
import { encryptCredentials } from "../src/platform/crypto";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspace } from "./factory";

afterEach(() => vi.unstubAllGlobals());

describe("delivery recovery schema and claims", () => {
  it("stores delivery lease ownership and indexes queued due work separately from expired sends", async () => {
    const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('deliveries')").all<{
      name: string;
    }>();
    const indexes = await env.DB.prepare("SELECT name FROM pragma_index_list('deliveries')").all<{
      name: string;
    }>();

    expect(columns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["lease_id", "lease_expires_at"]),
    );
    expect(indexes.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["deliveries_queued_due_idx", "deliveries_sending_lease_idx"]),
    );
  });

  it("does not claim future, terminal failed, or exhausted deliveries", async () => {
    const future = await seedDelivery({
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2999-01-01T00:00:00.000Z",
    });
    const failed = await seedDelivery({ status: "failed", attempts: 1 });
    const exhausted = await seedDelivery({ status: "queued", attempts: 5 });
    const repository = new DeliveryRecoveryRepository(createDatabase(env.DB));

    await expect(repository.claimDelivery(future)).resolves.toBeNull();
    await expect(repository.claimDelivery(failed)).resolves.toBeNull();
    await expect(repository.claimDelivery(exhausted)).resolves.toBeNull();
  });

  it("recovers stale webhook sends but makes stale email outcomes terminal", async () => {
    const webhook = await seedDelivery({ status: "sending", attempts: 2, channel: "webhook" });
    const exhaustedWebhook = await seedDelivery({
      status: "sending",
      attempts: 5,
      channel: "webhook",
    });
    const email = await seedDelivery({ status: "sending", attempts: 2, channel: "email" });
    const published: unknown[] = [];

    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithQueues(published),
      createExecutionContext(),
    );

    await expect(readDelivery(webhook)).resolves.toMatchObject({ status: "queued" });
    await expect(readDelivery(exhaustedWebhook)).resolves.toMatchObject({
      status: "failed",
      lastError: "attempts_exhausted",
    });
    await expect(readDelivery(email)).resolves.toMatchObject({
      status: "failed",
      lastError: "outcome_unknown",
    });
    expect(published).toContainEqual({ kind: "delivery", deliveryId: webhook });
    expect(published).not.toContainEqual({ kind: "delivery", deliveryId: exhaustedWebhook });
    expect(published).not.toContainEqual({ kind: "delivery", deliveryId: email });
  });

  it("claims one due delivery only once under parallel workers", async () => {
    const deliveryId = await seedDelivery({ status: "queued", attempts: 0 });
    const repository = new DeliveryRecoveryRepository(createDatabase(env.DB));

    const claims = await Promise.all([
      repository.claimDelivery(deliveryId),
      repository.claimDelivery(deliveryId),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(readDeliveryState(deliveryId)).resolves.toMatchObject({
      status: "sending",
      attempts: 1,
    });
  });

  it("rejects accepted, suppressed, and failure writes from a stale lease", async () => {
    const deliveryId = await seedDelivery({ status: "queued", attempts: 0 });
    const repository = new DeliveryRecoveryRepository(createDatabase(env.DB));
    const stale = await repository.claimDelivery(
      deliveryId,
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T00:01:00.000Z",
    );
    expect(stale).not.toBeNull();
    await repository.recoverExpiredDeliveries("2026-08-20T00:02:00.000Z");
    const current = await repository.claimDelivery(
      deliveryId,
      "2026-08-20T00:02:00.000Z",
      "2026-08-20T00:03:00.000Z",
    );
    expect(current).not.toBeNull();

    await expect(
      repository.markAccepted({
        deliveryId,
        leaseId: stale?.leaseId ?? "missing",
        providerMessageId: "stale-provider-id",
        acceptedAt: "2026-08-20T00:02:01.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.markSuppressed(deliveryId, stale?.leaseId ?? "missing", "stale suppression"),
    ).resolves.toBe(false);
    await expect(
      repository.recordFailure(deliveryId, stale?.leaseId ?? "missing", {
        status: "failed",
        nextAttemptAt: null,
        lastError: "stale failure",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.markProviderSuppressed(deliveryId, stale?.leaseId ?? "missing"),
    ).resolves.toBe(false);

    await expect(readDeliveryState(deliveryId)).resolves.toMatchObject({
      status: "sending",
      attempts: 2,
      leaseId: current?.leaseId,
    });
    const events = await createDatabase(env.DB)
      .orm.select({ id: deliveryEvents.id })
      .from(deliveryEvents);
    expect(events).toEqual([]);
    const suppressions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM suppressions WHERE workspace_id = ?",
    )
      .bind(current?.workspaceId ?? "missing-workspace")
      .first<{ count: number }>();
    expect(suppressions?.count).toBe(0);
  });

  it("retries a stale webhook with its original Idempotency-Key", async () => {
    const seeded = await seedSendableWebhook({ status: "sending", attempts: 1, expired: true });
    const repository = new DeliveryRecoveryRepository(createDatabase(env.DB));
    await repository.recoverExpiredDeliveries("2026-08-20T00:02:00.000Z");
    let receivedKey: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        receivedKey = new Headers(init?.headers).get("Idempotency-Key");
        return new Response(null, { status: 200 });
      }),
    );

    await processDelivery(seeded.deliveryId, runtimeWithQueues());

    expect(receivedKey).toBe(seeded.idempotencyKey);
    await expect(readDeliveryState(seeded.deliveryId)).resolves.toMatchObject({
      status: "accepted",
      attempts: 2,
    });
  });

  it("leaves provider-success database ambiguity in sending for stale recovery", async () => {
    const seeded = await seedSendableWebhook({ status: "queued", attempts: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await env.DB.prepare(
      `CREATE TRIGGER inject_delivery_accept_failure
       BEFORE UPDATE OF status ON deliveries
       WHEN OLD.id = '${seeded.deliveryId}' AND NEW.status = 'accepted'
       BEGIN SELECT RAISE(FAIL, 'injected accepted persistence failure'); END`,
    ).run();

    await expect(processDelivery(seeded.deliveryId, runtimeWithQueues())).rejects.toThrow(
      "injected accepted persistence failure",
    );
    await env.DB.prepare("DROP TRIGGER inject_delivery_accept_failure").run();

    await expect(readDeliveryState(seeded.deliveryId)).resolves.toMatchObject({
      status: "sending",
      attempts: 1,
      nextAttemptAt: null,
    });
    const event = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ?",
    )
      .bind(seeded.deliveryId)
      .first<{ count: number }>();
    expect(event?.count).toBe(0);
  });

  it("backs off definite transient failures and makes the fifth attempt terminal", async () => {
    const seeded = await seedSendableWebhook({ status: "queued", attempts: 0 });
    const fetcher = vi.fn<() => Promise<Response>>(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(processDelivery(seeded.deliveryId, runtimeWithQueues())).rejects.toThrow(
        "Delivery will be retried",
      );
      const state = await readDeliveryState(seeded.deliveryId);
      expect(state).toMatchObject({ status: "queued", attempts: attempt });
      expect(state?.nextAttemptAt).not.toBeNull();
      await env.DB.prepare("UPDATE deliveries SET next_attempt_at = NULL WHERE id = ?")
        .bind(seeded.deliveryId)
        .run();
    }

    await expect(processDelivery(seeded.deliveryId, runtimeWithQueues())).resolves.toBeUndefined();
    await expect(readDeliveryState(seeded.deliveryId)).resolves.toMatchObject({
      status: "failed",
      attempts: 5,
      nextAttemptAt: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});

async function seedDelivery(input: {
  status: string;
  attempts: number;
  channel?: "email" | "webhook";
  nextAttemptAt?: string | null;
}): Promise<string> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const id = uuidv7();
  const channel = input.channel ?? "webhook";
  const now = "2000-01-01T00:00:00.000Z";
  await createDatabase(env.DB)
    .orm.insert(deliveries)
    .values({
      id,
      workspaceId,
      channel,
      purpose: "transactional",
      provider: channel === "webhook" ? "webhook" : "cloudflare",
      recipient: "recipient@example.com",
      idempotencyKey: `key-${id}`,
      payload:
        channel === "webhook"
          ? JSON.stringify({
              kind: "webhook",
              idempotencyKey: `key-${id}`,
              workspaceId,
              deliveryId: id,
              endpointId: "endpoint",
              payload: {},
            })
          : JSON.stringify({
              kind: "email",
              idempotencyKey: `key-${id}`,
              workspaceId,
              deliveryId: id,
              purpose: "transactional",
              to: "recipient@example.com",
              from: { email: "sender@example.com" },
              subject: "Subject",
              html: "<p>Body</p>",
              text: "Body",
            }),
      status: input.status,
      attempts: input.attempts,
      nextAttemptAt: input.nextAttemptAt ?? null,
      leaseId: input.status === "sending" ? `lease-${id}` : null,
      leaseExpiresAt: input.status === "sending" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

function runtimeWithQueues(published: unknown[] = []): RuntimeEnv {
  const queue = {
    send: async () => {},
    sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
      published.push(...[...messages].map((message) => message.body));
    },
  } as unknown as Queue;
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE" || property === "DELIVERY_QUEUE") return queue;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

async function seedSendableWebhook(input: {
  status: "queued" | "sending";
  attempts: number;
  expired?: boolean;
}) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const deliveryId = uuidv7();
  const endpointId = uuidv7();
  const idempotencyKey = `stable-key-${deliveryId}`;
  const now = "2026-08-20T00:00:00.000Z";
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(webhookEndpoints).values({
      id: endpointId,
      workspaceId,
      name: "Recovery endpoint",
      url: "https://hooks.example.com/openengage",
      encryptedSecret: await encryptCredentials("test-encryption-key-at-least-32-characters", {
        secret: "webhook-secret",
      }),
      eventTypes: "[]",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(deliveries).values({
      id: deliveryId,
      workspaceId,
      channel: "webhook",
      purpose: "transactional",
      provider: "webhook",
      recipient: "https://hooks.example.com/openengage",
      idempotencyKey,
      payload: JSON.stringify({
        kind: "webhook",
        idempotencyKey,
        workspaceId,
        deliveryId,
        endpointId,
        payload: {},
      }),
      status: input.status,
      attempts: input.attempts,
      leaseId: input.status === "sending" ? `old-lease-${deliveryId}` : null,
      leaseExpiresAt:
        input.status === "sending" && input.expired ? "2026-08-20T00:01:00.000Z" : null,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return { workspaceId, deliveryId, endpointId, idempotencyKey };
}

async function readDelivery(deliveryId: string) {
  return env.DB.prepare("SELECT status, last_error AS lastError FROM deliveries WHERE id = ?")
    .bind(deliveryId)
    .first<{ status: string; lastError: string | null }>();
}

async function readDeliveryState(deliveryId: string) {
  return env.DB.prepare(
    `SELECT status, attempts, lease_id AS leaseId, lease_expires_at AS leaseExpiresAt,
            next_attempt_at AS nextAttemptAt, last_error AS lastError
     FROM deliveries WHERE id = ?`,
  )
    .bind(deliveryId)
    .first<{
      status: string;
      attempts: number;
      leaseId: string | null;
      leaseExpiresAt: string | null;
      nextAttemptAt: string | null;
      lastError: string | null;
    }>();
}
