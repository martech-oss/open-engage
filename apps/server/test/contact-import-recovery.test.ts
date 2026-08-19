import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { contacts, createDatabase, DataJobRepository, uuidv7 } from "@openengage/database";

import { processContactImport } from "../src/contacts/worker";
import type { RuntimeEnv } from "../src/env";
import { persistDeadLetter } from "../src/platform/maintenance-worker";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspace } from "./factory";

describe("contact import recovery", () => {
  it("reconciles only contacts actually inserted and counts identifier conflicts as failures", async () => {
    const fixture = await seedImport([
      { email: "duplicate@example.com" },
      { email: "created@example.com" },
      { email: "created@example.com" },
    ]);
    const now = new Date().toISOString();
    await createDatabase(env.DB).orm.insert(contacts).values({
      id: uuidv7(),
      workspaceId: fixture.workspaceId,
      email: "duplicate@example.com",
      status: "active",
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    });
    const published: unknown[] = [];

    await processContactImport(fixture.jobId, 0, 1, runtimeWithJobsQueue(queueStub(published)));

    const actual = await env.DB.prepare(
      "SELECT id FROM contacts WHERE workspace_id = ? AND email = 'created@example.com'",
    )
      .bind(fixture.workspaceId)
      .first<{ id: string }>();
    expect(published).toEqual([
      {
        kind: "segment_contact_reconcile",
        workspaceId: fixture.workspaceId,
        contactId: actual?.id,
      },
    ]);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 3,
      succeeded: 1,
      failed: 2,
    });
  });

  it("retries an insert-to-reconciliation failure without publishing phantom candidate IDs", async () => {
    const fixture = await seedImport([{ email: "recover@example.com" }]);
    const published: unknown[] = [];
    let fail = true;
    const runtime = runtimeWithJobsQueue(
      queueStub(published, async () => {
        if (fail) {
          fail = false;
          throw new Error("injected reconciliation outage");
        }
      }),
    );

    await expect(processContactImport(fixture.jobId, 0, 1, runtime)).rejects.toThrow(
      "injected reconciliation outage",
    );
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    await processContactImport(fixture.jobId, 0, 1, runtime);

    const actual = await env.DB.prepare(
      "SELECT id FROM contacts WHERE workspace_id = ? AND email = 'recover@example.com'",
    )
      .bind(fixture.workspaceId)
      .first<{ id: string }>();
    expect(published).toEqual([
      {
        kind: "segment_contact_reconcile",
        workspaceId: fixture.workspaceId,
        contactId: actual?.id,
      },
    ]);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it.each([
    { label: "totalParts", part: 0, totalParts: 99 },
    { label: "part", part: 1, totalParts: 2 },
  ])(
    "does not advance counters or publish from a mismatched $label",
    async ({ part, totalParts }) => {
      const fixture = await seedImport([{ email: "manifest@example.com" }], 2);
      const published: unknown[] = [];

      await expect(
        processContactImport(
          fixture.jobId,
          part,
          totalParts,
          runtimeWithJobsQueue(queueStub(published)),
        ),
      ).rejects.toThrow(/manifest|totalParts/i);

      expect(published).toEqual([]);
      await expect(readJob(fixture.jobId)).resolves.toMatchObject({
        status: "pending",
        processed: 0,
        succeeded: 0,
        failed: 0,
      });
    },
  );

  it("allows only one parallel message to execute a part", async () => {
    const fixture = await seedImport([{ email: "parallel@example.com" }]);
    const published: unknown[] = [];
    const runtime = runtimeWithJobsQueue(queueStub(published));

    await Promise.all([
      processContactImport(fixture.jobId, 0, 1, runtime),
      processContactImport(fixture.jobId, 0, 1, runtime),
    ]);

    expect(published).toHaveLength(1);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("replays the same owned id after enqueue succeeds but completion rolls back", async () => {
    const fixture = await seedImport([{ email: "completion-gap@example.com" }]);
    const published: unknown[] = [];
    await env.DB.prepare(
      `CREATE TRIGGER inject_import_completion_failure
       BEFORE UPDATE OF status ON contact_import_parts
       WHEN OLD.job_id = '${fixture.jobId}' AND NEW.status = 'completed'
       BEGIN SELECT RAISE(FAIL, 'injected import completion failure'); END`,
    ).run();

    await expect(
      processContactImport(fixture.jobId, 0, 1, runtimeWithJobsQueue(queueStub(published))),
    ).rejects.toThrow("injected import completion failure");
    await env.DB.prepare("DROP TRIGGER inject_import_completion_failure").run();
    await processContactImport(fixture.jobId, 0, 1, runtimeWithJobsQueue(queueStub(published)));

    expect(published).toHaveLength(2);
    expect(published[0]).toEqual(published[1]);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("leaves the next part durable when completion commits but direct publication fails", async () => {
    const fixture = await seedImport([{ email: "part-zero@example.com" }], 2);
    const runtime = runtimeWithJobsQueue({
      send: async () => {
        throw new Error("injected next-part publish failure");
      },
      sendBatch: async () => {},
    } as unknown as Queue);

    await expect(processContactImport(fixture.jobId, 0, 2, runtime)).rejects.toThrow(
      "injected next-part publish failure",
    );
    const beforeScan = await readPart(fixture.jobId, 1);
    expect(beforeScan).toMatchObject({ status: "pending", attempts: 0 });

    const published: unknown[] = [];
    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithJobsQueue(queueStub(published)),
      createExecutionContext(),
    );
    expect(published).toContainEqual({
      kind: "contact_import",
      importJobId: fixture.jobId,
      part: 1,
      totalParts: 2,
    });
  });

  it("makes a fifth failed part attempt terminal", async () => {
    const fixture = await seedImport([{ email: "fifth@example.com" }]);
    await env.DB.prepare(
      "UPDATE contact_import_parts SET attempts = 4 WHERE job_id = ? AND part = 0",
    )
      .bind(fixture.jobId)
      .run();
    const runtime = runtimeWithJobsQueue(
      queueStub([], async () => {
        throw new Error("fifth attempt outage");
      }),
    );

    await expect(processContactImport(fixture.jobId, 0, 1, runtime)).rejects.toThrow(
      /attempts exhausted/i,
    );

    await expect(readJob(fixture.jobId)).resolves.toMatchObject({ status: "failed" });
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "attempts_exhausted",
    });
  });

  it("returns an expired sub-ceiling part lease to pending and republishes it", async () => {
    const fixture = await seedImport([{ email: "stale-part@example.com" }]);
    await env.DB.prepare(
      `UPDATE contact_import_parts
       SET status = 'processing', attempts = 2, lease_id = 'expired-import-lease',
           lease_expires_at = '2000-01-01T00:00:00.000Z'
       WHERE job_id = ? AND part = 0`,
    )
      .bind(fixture.jobId)
      .run();
    const published: unknown[] = [];

    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithJobsQueue(queueStub(published)),
      createExecutionContext(),
    );

    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "pending",
      attempts: 2,
      lastError: "lease_expired",
    });
    expect(published).toContainEqual({
      kind: "contact_import",
      importJobId: fixture.jobId,
      part: 0,
      totalParts: 1,
    });
  });

  it("resolves import ownership and terminates its part when a message reaches the DLQ", async () => {
    const fixture = await seedImport([{ email: "dlq@example.com" }]);

    await persistDeadLetter(
      "openengage-dead-letter",
      { kind: "contact_import", importJobId: fixture.jobId, part: 0, totalParts: 1 },
      5,
      runtimeWithJobsQueue(queueStub([])),
    );

    await expect(readJob(fixture.jobId)).resolves.toMatchObject({ status: "failed" });
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "failed",
      lastError: "Queue retries exhausted",
    });
    const deadLetter = await env.DB.prepare(
      "SELECT workspace_id AS workspaceId FROM dead_letters WHERE message_body LIKE ?",
    )
      .bind(`%${fixture.jobId}%`)
      .first<{ workspaceId: string }>();
    expect(deadLetter?.workspaceId).toBe(fixture.workspaceId);
  });
});

async function seedImport(rows: Array<Record<string, string>>, totalParts = 1) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const jobId = uuidv7();
  const r2Key = `${workspaceId}/imports/${jobId}`;
  await env.ASSETS_BUCKET.put(
    `${r2Key}/part-0.ndjson`,
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  await new DataJobRepository(createDatabase(env.DB), { workspaceId }).createJob({
    id: jobId,
    kind: "contact_import",
    r2Key,
    cursor: { totalParts },
  });
  return { workspaceId, jobId };
}

function queueStub(
  published: unknown[],
  beforePublish: () => Promise<void> = async () => {},
): Queue {
  return {
    send: async (body: unknown) => {
      published.push(body);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
      await beforePublish();
      published.push(...[...messages].map((message) => message.body));
    },
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

async function readJob(jobId: string) {
  return env.DB.prepare(
    `SELECT status, processed, succeeded, failed
     FROM import_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<{ status: string; processed: number; succeeded: number; failed: number }>();
}

async function readPart(jobId: string, part: number) {
  return env.DB.prepare(
    `SELECT status, attempts, last_error AS lastError
     FROM contact_import_parts WHERE job_id = ? AND part = ?`,
  )
    .bind(jobId, part)
    .first<{ status: string; attempts: number; lastError: string | null }>();
}
