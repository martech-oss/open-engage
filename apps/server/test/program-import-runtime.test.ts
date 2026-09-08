import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";
import { ProjectMemberRepository } from "@openengage/database/projects";

import { processProgramMemberImport } from "../src/projects/program-import-service";
import { queue, scheduled } from "../src/runtime/dispatch";
import { queueStub, seedAutomationJob } from "./automation-recovery-test-support";
import { programFixture } from "./program-test-support";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const f = await programFixture();
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const job = await f.client.projects.memberImport({
    id: f.projectId,
    csv: `contactId\n${f.contactId}`,
    idempotencyKey: crypto.randomUUID(),
  });
  return { ...f, job };
}

describe("program import runtime integration", () => {
  it("refreshes the published version after a concurrent publication conflicts with enrollment", async () => {
    const f = await fixture();
    const members = new ProjectMemberRepository(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
    });
    const original = members.prepareMutation.bind(members);
    vi.spyOn(ProjectMemberRepository.prototype, "prepareMutation").mockImplementationOnce(
      async function (...args) {
        const prepared = await original(...args);
        await f.client.projects.programPublish({
          id: f.projectId,
          expectedRowVersion: 2,
          confirmed: true,
        });
        return prepared;
      },
    );
    await processProgramMemberImport(env, f.workspaceId, f.job.jobId);
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: f.job.jobId }),
    ).toMatchObject({
      status: "completed",
      rows: [{ ok: true, contactId: f.contactId }],
    });
    expect(await members.get(f.projectId, f.contactId)).toMatchObject({ definitionVersion: 2 });
    expect(await members.history(f.projectId, f.contactId)).toHaveLength(1);
  });

  it("recovers CSV work after a jobs Queue failure and dispatches the dedicated consumer", async () => {
    const f = await fixture();
    await seedAutomationJob({ status: "pending" });
    const outage = new Error("jobs queue unavailable");
    const send = vi.fn<(body: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const runtime = {
      ...env,
      JOBS_QUEUE: queueStub(async () => {
        throw outage;
      }),
      PROGRAM_MEMBER_IMPORT_QUEUE: { send },
    } as typeof env;
    await expect(
      scheduled(
        createScheduledController({ cron: "* * * * *" }),
        runtime,
        createExecutionContext(),
      ),
    ).rejects.toBe(outage);
    expect(send).toHaveBeenCalledWith({
      kind: "program_member_import",
      workspaceId: f.workspaceId,
      jobId: f.job.jobId,
    });
    const ack = vi.fn<() => void>(),
      retry = vi.fn<(options?: QueueRetryOptions) => void>();
    await queue(
      {
        queue: "custom-program-member-import",
        messages: [
          {
            id: "message",
            body: { kind: "program_member_import", workspaceId: f.workspaceId, jobId: f.job.jobId },
            attempts: 1,
            ack,
            retry,
          },
        ],
      } as unknown as MessageBatch,
      runtime,
    );
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: f.job.jobId }),
    ).toMatchObject({ status: "completed", processed: 1 });
  });
});
