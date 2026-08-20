import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { contacts, createDatabase, uuidv7 } from "@openengage/database/testing";

import { processContactImport } from "../src/contacts/worker";
import { scheduled } from "../src/runtime/dispatch";
import {
  queueStub,
  readJob,
  runtimeWithJobsQueue,
  seedImport,
} from "./contact-import-recovery-test-support";

describe("contact import reconciliation recovery", () => {
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

  it("recovers a post-insert reconciliation outage from durable completed-part evidence", async () => {
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
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtime,
      createExecutionContext(),
    );

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

  it("replays durable reconciliation when queue acceptance is ambiguous", async () => {
    const fixture = await seedImport([{ email: "completion-gap@example.com" }]);
    const published: unknown[] = [];
    let failAfterPublish = true;
    const runtime = runtimeWithJobsQueue({
      send: async (body: unknown) => {
        published.push(body);
      },
      sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
        published.push(...[...messages].map((message) => message.body));
        if (failAfterPublish) {
          failAfterPublish = false;
          throw new Error("injected ambiguous queue acceptance");
        }
      },
    } as unknown as Queue);

    await expect(processContactImport(fixture.jobId, 0, 1, runtime)).rejects.toThrow(
      "injected ambiguous queue acceptance",
    );
    await expect(readJob(fixture.jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtime,
      createExecutionContext(),
    );

    const reconciliations = published.filter(
      (message): message is Record<string, unknown> =>
        typeof message === "object" &&
        message !== null &&
        "kind" in message &&
        message.kind === "segment_contact_reconcile",
    );
    expect(reconciliations).toHaveLength(2);
    expect(reconciliations[0]).toEqual(reconciliations[1]);
  });
});
