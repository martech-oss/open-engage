import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  contacts,
  ContactImportPartExecutionRepository,
  ContactImportRecoveryRepository,
  createDatabase,
  DataJobRepository,
  type ContactImportRow,
  uuidv7,
} from "@openengage/database";

import { processContactImport } from "../src/contacts/worker";
import type { RuntimeEnv } from "../src/env";
import { scheduled } from "../src/runtime/dispatch";
import { seedWorkspace } from "./factory";

describe("contact import exact-once ledger", () => {
  it("commits no candidate without evidence when the lease expires inside the insert batch", async () => {
    const fixture = await seedImport(["phase-first@example.com", "phase-second@example.com"], 1);
    const triggerName = `expire_phase_${fixture.jobId.replaceAll("-", "_")}`;
    await env.DB.prepare(
      `CREATE TRIGGER ${triggerName}
       AFTER INSERT ON contacts
       WHEN NEW.workspace_id = '${fixture.workspaceId}'
       BEGIN
         UPDATE contact_import_parts
         SET lease_expires_at = '2000-01-01T00:00:00.000Z'
         WHERE job_id = '${fixture.jobId}' AND part = 0;
       END`,
    ).run();
    const published: unknown[] = [];
    try {
      await processContactImport(fixture.jobId, 0, 1, runtimeWithJobsQueue(queueStub(published)));
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${triggerName}`).run();
    }

    const ids = await listContactIds(fixture.workspaceId);
    const partBeforeRecovery = await readPart(fixture.jobId, 0);
    expect(ids).toHaveLength(2);
    expect(JSON.parse(partBeforeRecovery?.reconciliationContactIds ?? "null")).toEqual(ids);

    await runScheduled(runtimeWithJobsQueue(queueStub(published)));

    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(segmentReconciliations(published, fixture.workspaceId)).toHaveLength(2);
  });

  it("does not reclaim an evidence-bearing expired part after its conflict disappears", async () => {
    const fixture = await seedImport(["phase-conflict@example.com"], 1);
    const conflictId = await insertContact(fixture.workspaceId, "phase-conflict@example.com");
    const phase = await claimAndPersistPhase(fixture, ["phase-conflict@example.com"]);
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      attempts: 1,
      reconciliationContactIds: "[]",
    });
    await expireLease(fixture.jobId, 0);
    await createDatabase(env.DB).orm.delete(contacts).where(eq(contacts.id, conflictId));

    await processContactImport(fixture.jobId, 0, 1, runtimeWithJobsQueue(queueStub([])));

    await expect(listContactIds(fixture.workspaceId)).resolves.toEqual([]);
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "processing",
      attempts: 1,
      leaseId: phase.leaseId,
      reconciliationContactIds: "[]",
    });

    await runScheduled(runtimeWithJobsQueue(queueStub([])));

    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    await expect(listContactIds(fixture.workspaceId)).resolves.toEqual([]);
  });

  it("lets only one expired completion winner increment counters and create the next part", async () => {
    const fixture = await seedImport(["completion-winner@example.com"], 2);
    const phase = await claimAndPersistPhase(fixture, ["completion-winner@example.com"]);
    await expireLease(fixture.jobId, 0);
    const barrier = pauseTwoDatabaseBatches(env.DB);
    const execution = new ContactImportPartExecutionRepository(barrier.database);
    const now = new Date().toISOString();
    const completion = {
      jobId: fixture.jobId,
      part: 0,
      totalParts: 2,
      leaseId: phase.leaseId,
      now,
    };

    const first = execution.completePersistedPartForExpiredLease(completion);
    const second = execution.completePersistedPartForExpiredLease(completion);
    await barrier.reached;
    barrier.resume();
    const results = await Promise.all([first, second]);

    expect(results.toSorted((left, right) => Number(left) - Number(right))).toEqual([false, true]);
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "processing",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(countParts(fixture.jobId, 1)).resolves.toBe(1);
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(countPendingOutboxes(fixture.jobId, 0)).resolves.toBe(1);
  });

  it("finalizes committed evidence instead of letting the DLQ terminalize it", async () => {
    const fixture = await seedImport(["dlq-evidence@example.com"], 1);
    const paused = pauseCommittedDatabaseBatchResponse(env.DB);
    const published: unknown[] = [];
    const run = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(published), paused.database),
    );
    await paused.committed;

    await new ContactImportRecoveryRepository(createDatabase(env.DB)).failPartFromDeadLetter({
      jobId: fixture.jobId,
      part: 0,
      totalParts: 1,
      error: "Queue retries exhausted",
      now: new Date().toISOString(),
    });
    paused.resume();
    await run.catch(() => undefined);

    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({
      status: "completed",
      lastError: null,
    });

    await runScheduled(runtimeWithJobsQueue(queueStub(published)));
    expect(segmentReconciliations(published, fixture.workspaceId)).toHaveLength(1);
  });
});

async function seedImport(emails: string[], totalParts: number) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const jobId = uuidv7();
  const r2Key = `${workspaceId}/imports/${jobId}`;
  await env.ASSETS_BUCKET.put(
    `${r2Key}/part-0.ndjson`,
    emails.map((email) => JSON.stringify({ email })).join("\n"),
  );
  await new DataJobRepository(createDatabase(env.DB), { workspaceId }).createJob({
    id: jobId,
    kind: "contact_import",
    r2Key,
    cursor: { totalParts },
  });
  return { workspaceId, jobId, totalParts };
}

async function claimAndPersistPhase(
  fixture: Awaited<ReturnType<typeof seedImport>>,
  emails: string[],
) {
  const database = createDatabase(env.DB);
  const now = new Date().toISOString();
  const claim = await new ContactImportRecoveryRepository(database).claimPart({
    jobId: fixture.jobId,
    part: 0,
    totalParts: fixture.totalParts,
    now,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  if (claim.kind !== "claimed") throw new Error(`expected claim, received ${claim.kind}`);
  const execution = new ContactImportPartExecutionRepository(database);
  const rows = emails.map(contactImportRow);
  const manifest = await execution.reserveCandidates({
    jobId: fixture.jobId,
    part: 0,
    leaseId: claim.leaseId,
    now,
    processed: rows.length,
    rows,
  });
  if (!manifest) throw new Error("expected candidate manifest");
  await execution.persistCandidateInsertPhase({
    jobId: fixture.jobId,
    part: 0,
    leaseId: claim.leaseId,
    workspaceId: fixture.workspaceId,
    now,
    candidates: manifest.candidates,
  });
  return { leaseId: claim.leaseId };
}

function contactImportRow(email: string): ContactImportRow {
  return {
    email,
    externalId: null,
    firstName: null,
    lastName: null,
    phone: null,
    stage: "lead",
    customFields: {},
  };
}

async function insertContact(workspaceId: string, email: string): Promise<string> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await createDatabase(env.DB).orm.insert(contacts).values({
    id,
    workspaceId,
    email,
    status: "active",
    customFields: "{}",
    createdAt: now,
    updatedAt: now,
  });
  return id;
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

function pauseTwoDatabaseBatches(source: D1Database): {
  database: D1Database;
  reached: Promise<void>;
  resume: () => void;
} {
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
          if (batches === 2) markReached();
          await resumed;
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, reached, resume };
}

function pauseCommittedDatabaseBatchResponse(source: D1Database): {
  database: D1Database;
  committed: Promise<void>;
  resume: () => void;
} {
  let markCommitted!: () => void;
  let resume!: () => void;
  let paused = false;
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
          if (!paused) {
            paused = true;
            markCommitted();
            await resumed;
            throw new Error("injected committed phase response loss");
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

async function expireLease(jobId: string, part: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE contact_import_parts SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE job_id = ? AND part = ?",
  )
    .bind(jobId, part)
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

async function listContactIds(workspaceId: string): Promise<string[]> {
  const result = await env.DB.prepare("SELECT id FROM contacts WHERE workspace_id = ? ORDER BY id")
    .bind(workspaceId)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

async function countParts(jobId: string, part: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contact_import_parts WHERE job_id = ? AND part = ?",
  )
    .bind(jobId, part)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function countPendingOutboxes(jobId: string, part: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM contact_import_parts
     WHERE job_id = ? AND part = ? AND status = 'completed'
       AND reconciliation_contact_ids IS NOT NULL
       AND reconciliation_published_at IS NULL`,
  )
    .bind(jobId, part)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function readJob(jobId: string) {
  return env.DB.prepare("SELECT status, processed, succeeded, failed FROM import_jobs WHERE id = ?")
    .bind(jobId)
    .first<{ status: string; processed: number; succeeded: number; failed: number }>();
}

async function readPart(jobId: string, part: number) {
  return env.DB.prepare(
    `SELECT status, attempts, lease_id AS leaseId,
            reconciliation_contact_ids AS reconciliationContactIds,
            reconciliation_published_at AS reconciliationPublishedAt,
            processed, succeeded, failed, last_error AS lastError
     FROM contact_import_parts WHERE job_id = ? AND part = ?`,
  )
    .bind(jobId, part)
    .first<{
      status: string;
      attempts: number;
      leaseId: string | null;
      reconciliationContactIds: string | null;
      reconciliationPublishedAt: string | null;
      processed: number;
      succeeded: number;
      failed: number;
      lastError: string | null;
    }>();
}
