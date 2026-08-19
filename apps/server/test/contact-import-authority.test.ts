import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { contacts, createDatabase, DataJobRepository, uuidv7 } from "@openengage/database";

import { processContactImport } from "../src/contacts/worker";
import type { RuntimeEnv } from "../src/env";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspace } from "./factory";

describe("contact import database authority", () => {
  it("does not insert after the captured application time becomes an expired database lease", async () => {
    const fixture = await seedImport([{ email: "db-time-insert@example.com" }]);
    const published: unknown[] = [];
    const paused = pauseDatabaseBatch(env.DB, 1);
    const run = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(published), paused.database),
    );
    await paused.reached;
    const leaseId = await shortenLeaseAndWaitForDatabaseExpiry(fixture.jobId);

    paused.resume();
    await run;

    await expect(countContacts(fixture.workspaceId, "db-time-insert@example.com")).resolves.toBe(0);
    expect(published).toEqual([]);
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      leaseId,
    });
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("does not complete or publish after the captured application time becomes an expired database lease", async () => {
    const fixture = await seedImport([{ email: "db-time-complete@example.com" }]);
    const published: unknown[] = [];
    const paused = pauseDatabaseBatch(env.DB, 2);
    const run = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(published), paused.database),
    );
    await paused.reached;
    await expect(countContacts(fixture.workspaceId, "db-time-complete@example.com")).resolves.toBe(
      1,
    );
    const leaseId = await shortenLeaseAndWaitForDatabaseExpiry(fixture.jobId);

    paused.resume();
    await run;

    expect(published).toEqual([]);
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      leaseId,
    });
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("finalizes a fifth-attempt insert whose committed batch response is lost", async () => {
    const fixture = await seedImport([{ email: "fifth-commit-loss@example.com" }]);
    await setPartAttempts(fixture.jobId, 4);
    const published: unknown[] = [];
    const runtime = runtimeWithJobsQueue(
      queueStub(published),
      commitThenLoseNextDatabaseBatchResponse(
        env.DB,
        new Error("injected committed insert response loss"),
      ),
    );

    await processContactImport(fixture.jobId, 0, 1, runtime).catch(() => undefined);
    await runScheduled(runtime);
    await runScheduled(runtime);

    await expect(countContacts(fixture.workspaceId, "fifth-commit-loss@example.com")).resolves.toBe(
      1,
    );
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      attempts: 5,
    });
    expect(segmentReconciliations(published, fixture.workspaceId)).toHaveLength(1);
  });

  it("finalizes committed fifth-attempt evidence when the lost response arrives after expiry", async () => {
    const fixture = await seedImport([{ email: "fifth-delayed-loss@example.com" }]);
    await setPartAttempts(fixture.jobId, 4);
    const paused = pauseCommittedDatabaseBatchResponse(
      env.DB,
      new Error("injected delayed committed insert response loss"),
    );
    const run = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub([]), paused.database),
    );
    await paused.committed;
    await shortenLeaseAndWaitForDatabaseExpiry(fixture.jobId);

    paused.resume();
    await run.catch(() => undefined);

    await expect(
      countContacts(fixture.workspaceId, "fifth-delayed-loss@example.com"),
    ).resolves.toBe(1);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      attempts: 5,
    });
  });

  it("lets the scanner finalize fifth-attempt evidence when worker recovery also fails", async () => {
    const fixture = await seedImport([{ email: "fifth-scanner-recovery@example.com" }]);
    await setPartAttempts(fixture.jobId, 4);
    const published: unknown[] = [];
    const workerRuntime = runtimeWithJobsQueue(
      queueStub(published),
      commitThenLoseInsertAndFailCompletionBatch(env.DB),
    );

    await processContactImport(fixture.jobId, 0, 1, workerRuntime).catch(() => undefined);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    await shortenLeaseAndWaitForDatabaseExpiry(fixture.jobId);

    await runScheduled(runtimeWithJobsQueue(queueStub(published)));

    await expect(
      countContacts(fixture.workspaceId, "fifth-scanner-recovery@example.com"),
    ).resolves.toBe(1);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      attempts: 5,
    });
    expect(segmentReconciliations(published, fixture.workspaceId)).toHaveLength(1);
  });

  it("finalizes a fifth-attempt all-conflict insert response loss as an explicit empty result", async () => {
    const fixture = await seedImport([{ email: "fifth-conflict@example.com" }]);
    const now = new Date().toISOString();
    await createDatabase(env.DB).orm.insert(contacts).values({
      id: uuidv7(),
      workspaceId: fixture.workspaceId,
      email: "fifth-conflict@example.com",
      status: "active",
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await setPartAttempts(fixture.jobId, 4);
    const published: unknown[] = [];
    const runtime = runtimeWithJobsQueue(
      queueStub(published),
      commitThenLoseNextDatabaseBatchResponse(
        env.DB,
        new Error("injected committed conflict response loss"),
      ),
    );

    await processContactImport(fixture.jobId, 0, 1, runtime).catch(() => undefined);
    await runScheduled(runtime);

    await expect(countContacts(fixture.workspaceId, "fifth-conflict@example.com")).resolves.toBe(1);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    await expect(readPart(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      attempts: 5,
      reconciliationContactIds: "[]",
    });
    expect(segmentReconciliations(published, fixture.workspaceId)).toEqual([]);
  });
});

async function seedImport(rows: Array<Record<string, string>>) {
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
    cursor: { totalParts: 1 },
  });
  return { workspaceId, jobId };
}

function runtimeWithJobsQueue(queue: Queue, database: D1Database = env.DB): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return queue;
      if (property === "DB") return database;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

function queueStub(published: unknown[]): Queue {
  return {
    send: async (body: unknown) => {
      published.push(body);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
      published.push(...[...messages].map((message) => message.body));
    },
  } as unknown as Queue;
}

function pauseDatabaseBatch(
  source: D1Database,
  batchNumber: number,
): { database: D1Database; reached: Promise<void>; resume: () => void } {
  let markReached!: () => void;
  let resume!: () => void;
  let batches = 0;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const database = new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          batches += 1;
          if (batches === batchNumber) {
            markReached();
            await resumed;
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, reached, resume };
}

function commitThenLoseNextDatabaseBatchResponse(source: D1Database, error: Error): D1Database {
  let lost = false;
  return new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          if (!lost) {
            lost = true;
            throw error;
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseCommittedDatabaseBatchResponse(
  source: D1Database,
  error: Error,
): { database: D1Database; committed: Promise<void>; resume: () => void } {
  let markCommitted!: () => void;
  let resume!: () => void;
  let lost = false;
  const committed = new Promise<void>((resolve) => {
    markCommitted = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const database = new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          if (!lost) {
            lost = true;
            markCommitted();
            await resumed;
            throw error;
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, committed, resume };
}

function commitThenLoseInsertAndFailCompletionBatch(source: D1Database): D1Database {
  let batches = 0;
  return new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          batches += 1;
          if (batches === 1) {
            await target.batch(statements);
            throw new Error("injected committed insert response loss");
          }
          if (batches === 2) throw new Error("injected worker completion outage");
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function shortenLeaseAndWaitForDatabaseExpiry(jobId: string): Promise<string> {
  const before = await env.DB.prepare(
    "SELECT lease_id AS leaseId FROM contact_import_parts WHERE job_id = ? AND part = 0",
  )
    .bind(jobId)
    .first<{ leaseId: string }>();
  if (!before?.leaseId) throw new Error("expected claimed import lease");
  const expiresAt = new Date(Date.now() + 100).toISOString();
  await env.DB.prepare(
    "UPDATE contact_import_parts SET lease_expires_at = ? WHERE job_id = ? AND part = 0",
  )
    .bind(expiresAt, jobId)
    .run();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await env.DB.prepare(
      `SELECT lease_id AS leaseId,
              lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS expired
       FROM contact_import_parts WHERE job_id = ? AND part = 0`,
    )
      .bind(jobId)
      .first<{ leaseId: string; expired: number }>();
    expect(state?.leaseId).toBe(before.leaseId);
    if (state?.expired === 1) return before.leaseId;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("database clock did not pass the import lease deadline");
}

async function setPartAttempts(jobId: string, attempts: number): Promise<void> {
  await env.DB.prepare("UPDATE contact_import_parts SET attempts = ? WHERE job_id = ? AND part = 0")
    .bind(attempts, jobId)
    .run();
}

async function runScheduled(runtime: RuntimeEnv): Promise<void> {
  await scheduled(
    createScheduledController({ cron: "* * * * *" }),
    runtime,
    createExecutionContext(),
  );
}

function segmentReconciliations(published: unknown[], workspaceId: string): unknown[] {
  return published.filter(
    (message): message is Record<string, unknown> =>
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "segment_contact_reconcile" &&
      "workspaceId" in message &&
      message.workspaceId === workspaceId,
  );
}

async function countContacts(workspaceId: string, email: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND email = ?",
  )
    .bind(workspaceId, email)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function readJob(jobId: string) {
  return env.DB.prepare(
    `SELECT status, processed, succeeded, failed
     FROM import_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<{ status: string; processed: number; succeeded: number; failed: number }>();
}

async function readPart(jobId: string) {
  return env.DB.prepare(
    `SELECT status, attempts, lease_id AS leaseId,
            reconciliation_contact_ids AS reconciliationContactIds
     FROM contact_import_parts WHERE job_id = ? AND part = 0`,
  )
    .bind(jobId)
    .first<{
      status: string;
      attempts: number;
      leaseId: string | null;
      reconciliationContactIds: string | null;
    }>();
}
