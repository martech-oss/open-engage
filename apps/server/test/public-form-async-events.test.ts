import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app";
import type { RuntimeEnv } from "../src/env";
import { withBindings } from "./bindings";
import { seedWorkspaceClient } from "./factory";
import { queueDouble } from "./queue-double";

afterEach(() => vi.restoreAllMocks());

function bindings(queue: Queue): RuntimeEnv {
  return withBindings({ JOBS_QUEUE: queue });
}

function executionContext(waitUntilPromises: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as ExecutionContext;
}

async function createPublicForm(suffix: string) {
  const fixture = await seedWorkspaceClient(env.DB);
  const slug = `async-${suffix}`;
  await fixture.client.website.createForm({
    name: "Async form",
    slug,
    status: "published",
    definition: {
      fields: [{ key: "email", kind: "standard", type: "email", required: true }],
    },
    allowedDomains: [],
    turnstileEnabled: false,
    successMessage: "Queued",
  });
  return { ...fixture, path: `/f/${fixture.slug}/${slug}` };
}

function submit(
  path: string,
  runtime: RuntimeEnv,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<Response> | Response {
  return app.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "async@example.com", idempotencyKey }),
    }),
    runtime,
    context,
  );
}

describe("public form contact-event publication", () => {
  it("returns 202 while the contact-event queue publication remains unresolved", async () => {
    const form = await createPublicForm("non-blocking");
    let releasePublication!: () => void;
    let publicationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      publicationStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    const batches: Array<Array<MessageSendRequest<unknown>>> = [];
    const waits: Promise<unknown>[] = [];
    const runtime = bindings(
      queueDouble({
        sendBatch: async (messages) => {
          batches.push(messages);
          publicationStarted();
          await blocked;
        },
      }),
    );
    let responseResolved = false;
    const responsePromise = Promise.resolve(
      submit(form.path, runtime, executionContext(waits), crypto.randomUUID()),
    ).then((response) => {
      responseResolved = true;
      return response;
    });

    try {
      await started;
      await vi.waitFor(() => expect(responseResolved).toBe(true), { timeout: 150 });
      const response = await responsePromise;

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ data: { accepted: true, message: "Queued" } });
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
      expect(batches[0]?.map((entry) => entry.body)).toEqual([
        { kind: "contact_event", eventId: expect.any(String) },
        { kind: "contact_event", eventId: expect.any(String) },
      ]);
      expect(waits).toHaveLength(1);
    } finally {
      releasePublication();
      await Promise.allSettled([responsePromise, ...waits]);
    }
  });

  it("keeps the accepted response when queue publication rejects", async () => {
    const form = await createPublicForm("queue-rejection");
    const waits: Promise<unknown>[] = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = bindings(
      queueDouble({
        sendBatch: async () => {
          throw new Error("queue unavailable");
        },
      }),
    );

    const response = await submit(form.path, runtime, executionContext(waits), crypto.randomUUID());
    await Promise.all(waits);

    expect(response.status).toBe(202);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("public_form.event_enqueue_failed"),
    );
  });

  it("does not publish contact events for a duplicate submission", async () => {
    const form = await createPublicForm("duplicate");
    const batches: Array<Array<MessageSendRequest<unknown>>> = [];
    const waits: Promise<unknown>[] = [];
    const runtime = bindings(
      queueDouble({
        sendBatch: async (messages) => {
          batches.push(messages);
        },
      }),
    );
    const context = executionContext(waits);
    const idempotencyKey = crypto.randomUUID();

    const first = await submit(form.path, runtime, context, idempotencyKey);
    await Promise.all(waits);
    const duplicate = await submit(form.path, runtime, context, idempotencyKey);

    expect(first.status).toBe(202);
    expect(await duplicate.json()).toEqual({ data: { accepted: true, duplicate: true } });
    expect(batches).toHaveLength(1);
  });
});
