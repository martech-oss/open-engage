import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";
import {
  ProgramMemberImportRepository,
  ProjectMemberRepository,
} from "@openengage/database/projects";
import { auditLogs } from "@openengage/database/testing";

import {
  importProgramMembers,
  processProgramMemberImport,
  recoverProgramMemberImports,
} from "../src/projects/program-import-service";
import { programFixture } from "./program-test-support";
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
  return f;
}
describe("resumable program member CSV jobs", () => {
  it("accepts idempotently, rejects changed CSV, processes 25 ordered rows and resumes", async () => {
    const f = await fixture();
    const input = {
      id: f.projectId,
      idempotencyKey: crypto.randomUUID(),
      csv:
        `contactId,statusId\n${f.contactId},registered\n${f.contactId},attended\n` +
        Array.from({ length: 24 }, () => "missing,registered").join("\n"),
    };
    const accepted = await f.client.projects.memberImport(input);
    expect(accepted).toMatchObject({ status: "pending", processed: 0, total: 26, rows: [] });
    expect(await f.client.projects.memberImport(input)).toEqual(accepted);
    await expect(
      f.client.projects.memberImport({ ...input, csv: input.csv + "\nmissing,registered" }),
    ).rejects.toMatchObject({ code: "PROGRAM_CONFLICT" });
    await expect(
      f.client.projects.memberImport({ ...input, csv: "unsupported\nvalue" }),
    ).rejects.toMatchObject({ code: "PROGRAM_CONFLICT" });
    const runtime = {
      ...env,
      PROGRAM_MEMBER_IMPORT_QUEUE: {
        send: vi.fn<(message: unknown) => Promise<void>>().mockResolvedValue(undefined),
      },
    };
    await processProgramMemberImport(runtime as typeof env, f.workspaceId, accepted.jobId);
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).toMatchObject({ processed: 25, status: "pending" });
    await processProgramMemberImport(runtime as typeof env, f.workspaceId, accepted.jobId);
    const done = await f.client.projects.memberImportGet({
      id: f.projectId,
      jobId: accepted.jobId,
    });
    expect(done).toMatchObject({ processed: 26, status: "completed" });
    expect(done.rows.map((r) => r.ok)).toEqual([true, true, ...Array(24).fill(false)]);
    await processProgramMemberImport(runtime as typeof env, f.workspaceId, accepted.jobId);
    expect(
      await f.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
    ).toHaveLength(2);
    const audits = await createDatabase(env.DB)
      .orm.select()
      .from(auditLogs)
      .where(eq(auditLogs.id, `program-import:${accepted.jobId}`));
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]!.metadata)).toMatchObject({ succeeded: 2, failed: 24 });
  });
  it("fences expired leases and recovers an interrupted job", async () => {
    const f = await fixture();
    const accepted = await f.client.projects.memberImport({
      id: f.projectId,
      idempotencyKey: crypto.randomUUID(),
      csv: `contactId\n${f.contactId}`,
    });
    const repository = new ProgramMemberImportRepository(createDatabase(env.DB), {
      workspaceId: f.workspaceId,
    });
    const old = await repository.claim(accepted.jobId, "2000-01-01T00:00:00.000Z");
    expect(old).toBeTruthy();
    const send = vi.fn<(message: unknown) => Promise<void>>().mockResolvedValue(undefined);
    await recoverProgramMemberImports({
      ...env,
      PROGRAM_MEMBER_IMPORT_QUEUE: { send },
    } as typeof env);
    expect(send).toHaveBeenCalledWith({
      kind: "program_member_import",
      workspaceId: f.workspaceId,
      jobId: accepted.jobId,
    });
    await processProgramMemberImport(
      { ...env, PROGRAM_MEMBER_IMPORT_QUEUE: { send } } as typeof env,
      f.workspaceId,
      accepted.jobId,
    );
    await expect(
      repository.commitRow(old!, { row: 2, ok: false, error: "stale" }, []),
    ).rejects.toThrow();
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).toMatchObject({ status: "completed", rows: [{ row: 2, ok: true }] });
  });
  it("keeps acceptance durable when queue sending fails and rejects >1000 rows", async () => {
    const f = await fixture();
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi
      .fn<(message: unknown) => Promise<void>>()
      .mockRejectedValue(new Error("queue unavailable"));
    const runtime = { ...env, PROGRAM_MEMBER_IMPORT_QUEUE: { send } } as typeof env;
    const input = {
      projectId: f.projectId,
      idempotencyKey: crypto.randomUUID(),
      csv: `contactId\n${f.contactId}`,
    };
    const accepted = await importProgramMembers(runtime, { ...f, role: "owner" }, input);
    expect(accepted).toMatchObject({ status: "pending", processed: 0 });
    send.mockResolvedValue(undefined);
    await recoverProgramMemberImports(runtime);
    await processProgramMemberImport(runtime, f.workspaceId, accepted.jobId);
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).toMatchObject({ status: "completed" });
    await expect(
      importProgramMembers(
        runtime,
        { ...f, role: "owner" },
        {
          ...input,
          idempotencyKey: crypto.randomUUID(),
          csv: "contactId\n" + Array(1001).fill("missing").join("\n"),
        },
      ),
    ).rejects.toThrow(/1000/);
    const other = await fixture();
    await expect(
      other.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).rejects.toThrow();
    logger.mockRestore();
  });
  it("rolls back prepared member writes under a stale lease and resumes a committed row", async () => {
    const f = await fixture();
    const accepted = await f.client.projects.memberImport({
      id: f.projectId,
      idempotencyKey: crypto.randomUUID(),
      csv: `contactId,statusId\n${f.contactId},registered\n${f.contactId},attended`,
    });
    const database = createDatabase(env.DB);
    const repository = new ProgramMemberImportRepository(database, { workspaceId: f.workspaceId });
    const members = new ProjectMemberRepository(database, { workspaceId: f.workspaceId });
    const old = await repository.claim(accepted.jobId, "2000-01-01T00:00:00.000Z");
    const prepared = await members.prepareMutation({
      projectId: f.projectId,
      contactId: f.contactId,
      source: "csv",
      statusId: "registered",
      idempotencyKey: `${accepted.jobId}:2`,
    });
    await expect(
      repository.commitRow(old!, { row: 2, ok: true, contactId: f.contactId }, prepared.statements),
    ).rejects.toThrow();
    expect(await members.get(f.projectId, f.contactId)).toBeNull();
    const current = await repository.claim(accepted.jobId);
    await repository.commitRow(
      current!,
      { row: 2, ok: true, contactId: f.contactId },
      prepared.statements,
    );
    // Simulate the process stopping after an atomic success, before releasing its chunk.
    await repository.release(current!);
    await processProgramMemberImport(env, f.workspaceId, accepted.jobId);
    expect(await members.history(f.projectId, f.contactId)).toHaveLength(2);
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).toMatchObject({ processed: 2, status: "completed" });
  });
  it("drains 1000 rows in bounded chunks", async () => {
    const f = await fixture();
    const accepted = await f.client.projects.memberImport({
      id: f.projectId,
      idempotencyKey: crypto.randomUUID(),
      csv: "contactId\n" + Array(1000).fill(f.contactId).join("\n"),
    });
    const runtime = {
      ...env,
      PROGRAM_MEMBER_IMPORT_QUEUE: {
        send: vi.fn<(message: unknown) => Promise<void>>().mockResolvedValue(undefined),
      },
    };
    for (let i = 0; i < 40; i++)
      await processProgramMemberImport(runtime as typeof env, f.workspaceId, accepted.jobId);
    expect(
      await f.client.projects.memberImportGet({ id: f.projectId, jobId: accepted.jobId }),
    ).toMatchObject({ status: "completed", processed: 1000, total: 1000 });
  }, 60000);
});
