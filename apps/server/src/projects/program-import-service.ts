import {
  parseProgramMemberCsv,
  programMemberMutationSchema,
  type ProgramMemberImportRow,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase } from "@openengage/database/client";
import {
  ProgramMemberImportRepository,
  ProgramMemberImportRecoveryRepository,
  ProjectMemberRepository,
  ProjectProgramRepository,
  ProgramError,
  isProgramWriteConflict,
} from "@openengage/database/projects";

import type { RuntimeEnv } from "../env";
import { logError } from "../observability";

async function enqueue(env: RuntimeEnv, workspaceId: string, jobId: string) {
  // The persisted pending job remains recoverable if Queue publication fails.
  try {
    await env.PROGRAM_MEMBER_IMPORT_QUEUE.send({
      kind: "program_member_import",
      workspaceId,
      jobId,
    });
  } catch (error) {
    logError("program_import.publication_failed", error, { workspaceId, jobId });
  }
}
export async function importProgramMembers(
  env: RuntimeEnv,
  workspace: WorkspaceContext,
  input: { projectId: string; csv: string; idempotencyKey: string },
) {
  const repository = new ProgramMemberImportRepository(env.DB, workspace);
  const prior = await repository.findRequest(input.projectId, input.idempotencyKey);
  if (prior) {
    if (prior.csv !== input.csv)
      throw new ProgramError("conflict", "Request key was used with different CSV input");
    if (prior.status !== "completed") await enqueue(env, workspace.workspaceId, prior.id);
    return repository.detail(input.projectId, prior.id);
  }
  let parsed;
  try {
    parsed = parseProgramMemberCsv(input.csv);
  } catch (error) {
    throw new ProgramError("invalid", error instanceof Error ? error.message : "Invalid CSV");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.csv));
  const fingerprint = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const job = await repository.accept({
    projectId: input.projectId,
    requestKey: input.idempotencyKey,
    csv: input.csv,
    fingerprint,
    total: parsed.length,
    actorUserId: workspace.userId,
  });
  if (job.status !== "completed") await enqueue(env, workspace.workspaceId, job.id);
  return repository.detail(input.projectId, job.id);
}
export async function processProgramMemberImport(
  env: RuntimeEnv,
  workspaceId: string,
  jobId: string,
) {
  const database = createDatabase(env.DB);
  const repository = new ProgramMemberImportRepository(database, { workspaceId });
  const job = await repository.claim(jobId);
  if (!job) return;
  const members = new ProjectMemberRepository(database, { workspaceId });
  // Immutable published definitions are reused only for this 25-row processing unit.
  const programs = new ProjectProgramRepository(database, { workspaceId });
  const rows = parseProgramMemberCsv(job.csv).slice(job.processed, job.processed + 25);
  let cache;
  try {
    const program = await programs.get(job.projectId);
    cache = {
      publishedVersion: program?.publishedVersion ?? null,
      definitions: new Map(program?.versions.map((v) => [v.version, v.definition]) ?? []),
    };
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    for (const row of rows)
      await repository.commitRow(job, { row: row.row, ok: false, error: error.message }, []);
    await repository.release(job);
    if (job.processed < job.total) await enqueue(env, workspaceId, jobId);
    return;
  }
  for (const row of rows) {
    let result: ProgramMemberImportRow;
    if ("error" in row) result = { row: row.row, ok: false, error: row.error };
    else {
      const contactId = await members.findContact(row);
      if (!contactId)
        result = {
          row: row.row,
          ok: false,
          error:
            "Contact ID/email was not found or does not identify the same contact in this workspace",
        };
      else {
        try {
          const input = programMemberMutationSchema.safeParse({
            projectId: job.projectId,
            contactId,
            ...(row.statusId ? { statusId: row.statusId } : {}),
            source: "csv",
            idempotencyKey: `${job.id}:${row.row}`,
          });
          if (!input.success) throw new ProgramError("invalid", input.error.message);
          let applied = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            const prepared = await members.prepareMutation(
              { ...input.data, actorUserId: job.actorUserId },
              undefined,
              cache,
            );
            try {
              await repository.commitRow(
                job,
                { row: row.row, ok: true, contactId },
                prepared.statements,
              );
              applied = true;
              break;
            } catch (error) {
              if (!isProgramWriteConflict(error)) throw error;
              // A new publication can invalidate enrollment's compare-and-swap guard.
              // Reload only on contention; normal rows reuse the immutable definitions.
              const current = await programs.get(job.projectId);
              cache.publishedVersion = current?.publishedVersion ?? null;
              for (const version of current?.versions ?? [])
                cache.definitions.set(version.version, version.definition);
            }
          }
          if (!applied) throw new ProgramError("conflict", "Member changed by another writer");
          continue;
        } catch (error) {
          if (!(error instanceof ProgramError)) throw error;
          result = { row: row.row, ok: false, error: error.message };
        }
      }
    }
    await repository.commitRow(job, result, []);
  }
  await repository.release(job);
  if (job.processed < job.total) await enqueue(env, workspaceId, jobId);
}
export async function recoverProgramMemberImports(env: RuntimeEnv) {
  for (const job of await new ProgramMemberImportRecoveryRepository(env.DB).recoverable())
    await enqueue(env, job.workspaceId, job.jobId);
}
