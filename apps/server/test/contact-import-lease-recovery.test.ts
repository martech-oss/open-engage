import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ContactImportRecoveryRepository, createDatabase } from "@openengage/database/testing";

import { processContactImport } from "../src/contacts/worker";
import { persistDeadLetter } from "../src/platform/maintenance-worker";
import { scheduled } from "../src/runtime/dispatch";
import {
  countContacts,
  expirePartLease,
  failNextDatabaseBatch,
  pauseNextDatabaseBatch,
  queueStub,
  readJob,
  readPart,
  runtimeWithJobsQueue,
  seedImport,
} from "./contact-import-recovery-test-support";

describe("contact import lease and terminal recovery", () => {
  it("does not insert or reconcile after its expired lease is replaced and terminated", async () => {
    const fixture = await seedImport([{ email: "terminal-race@example.com" }]);
    const published: unknown[] = [];
    const paused = pauseNextDatabaseBatch(env.DB);
    const staleRun = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(published), paused.database),
    );
    await paused.reached;
    await expirePartLease(fixture.jobId);
    const replacement = await new ContactImportRecoveryRepository(createDatabase(env.DB)).claimPart(
      {
        jobId: fixture.jobId,
        part: 0,
        totalParts: 1,
        now: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    expect(replacement.kind).toBe("claimed");
    await persistDeadLetter(
      "openengage-dead-letter",
      { kind: "contact_import", importJobId: fixture.jobId, part: 0, totalParts: 1 },
      5,
      runtimeWithJobsQueue(queueStub([])),
    );

    paused.resume();
    await staleRun;

    await expect(countContacts(fixture.workspaceId, "terminal-race@example.com")).resolves.toBe(0);
    expect(published).toEqual([]);
    await expect(readPart(fixture.jobId, 0)).resolves.toMatchObject({ status: "failed" });
  });

  it("lets the current owner insert and count a candidate when a stale owner resumes first", async () => {
    const fixture = await seedImport([{ email: "owner-race@example.com" }]);
    const stalePublished: unknown[] = [];
    const currentPublished: unknown[] = [];
    const stale = pauseNextDatabaseBatch(env.DB);
    const staleRun = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(stalePublished), stale.database),
    );
    await stale.reached;
    await expirePartLease(fixture.jobId);
    const current = pauseNextDatabaseBatch(env.DB);
    const currentRun = processContactImport(
      fixture.jobId,
      0,
      1,
      runtimeWithJobsQueue(queueStub(currentPublished), current.database),
    );
    await current.reached;

    stale.resume();
    await staleRun;
    current.resume();
    await currentRun;

    const contact = await env.DB.prepare(
      "SELECT id FROM contacts WHERE workspace_id = ? AND email = 'owner-race@example.com'",
    )
      .bind(fixture.workspaceId)
      .first<{ id: string }>();
    expect(stalePublished).toEqual([]);
    expect(currentPublished).toEqual([
      {
        kind: "segment_contact_reconcile",
        workspaceId: fixture.workspaceId,
        contactId: contact?.id,
      },
    ]);
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
      queueStub([]),
      failNextDatabaseBatch(env.DB, new Error("fifth attempt outage")),
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
