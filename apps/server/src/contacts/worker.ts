import { contactExportFilterSchema } from "@openengage/core/contacts";
import { createDatabase } from "@openengage/database/client";
import {
  ContactImportPartExecutionRepository,
  ContactImportRecoveryRepository,
  ContactImportReconciliationRepository,
  DataJobWorkerRepository,
  type ContactImportReconciliation,
  type ContactImportRow,
} from "@openengage/database/contacts";

import { PermanentChannelError, TransientChannelError } from "../channels";
import { type RuntimeEnv } from "../env";
import { parseJsonRecord, stringValue } from "../platform/values";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";

export async function processContactImport(
  jobId: string,
  part: number,
  totalParts: number,
  env: RuntimeEnv,
): Promise<void> {
  const database = createDatabase(env.DB);
  const repository = new ContactImportRecoveryRepository(database);
  const executionRepository = new ContactImportPartExecutionRepository(database);
  const reconciliationRepository = new ContactImportReconciliationRepository(database);
  const now = new Date().toISOString();
  const claim = await repository.claimPart({
    jobId,
    part,
    totalParts,
    now,
    leaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  if (claim.kind !== "claimed") {
    if (claim.kind === "manifest_mismatch") {
      throw new PermanentChannelError("Import queue manifest does not match persisted part state");
    }
    return;
  }

  try {
    let manifest = claim.candidates;
    if (!manifest) {
      const object = await env.ASSETS_BUCKET.get(`${claim.r2Key}/part-${part}.ndjson`);
      if (!object) throw new PermanentChannelError(`Import part ${part} is missing`);
      const lines = (await object.text()).split("\n").filter(Boolean);
      manifest = await executionRepository.reserveCandidates({
        jobId,
        part,
        leaseId: claim.leaseId,
        now: new Date().toISOString(),
        processed: lines.length,
        rows: normalizeImportRows(lines),
      });
      if (!manifest) return;
    }
    await executionRepository.persistCandidateInsertPhase({
      jobId,
      part,
      leaseId: claim.leaseId,
      workspaceId: claim.workspaceId,
      now: new Date().toISOString(),
      candidates: manifest.candidates,
    });
    const completed = await executionRepository.completePersistedPartForLiveLease({
      jobId,
      part,
      totalParts,
      leaseId: claim.leaseId,
      now: new Date().toISOString(),
    });
    if (completed) {
      const reconciliation = await reconciliationRepository.readPending(jobId, part);
      if (reconciliation) {
        await publishContactImportReconciliation(
          reconciliationRepository,
          reconciliation,
          env.JOBS_QUEUE,
        );
      }
    }
    if (completed && part + 1 < totalParts) {
      await env.JOBS_QUEUE.send({
        kind: "contact_import",
        importJobId: jobId,
        part: part + 1,
        totalParts,
      });
    }
  } catch (error) {
    const completion = {
      jobId,
      part,
      totalParts,
      leaseId: claim.leaseId,
      now: new Date().toISOString(),
    };
    const recovered =
      (await executionRepository.completePersistedPartForLiveLease(completion)) ||
      (await executionRepository.completePersistedPartForExpiredLease({
        ...completion,
        now: new Date().toISOString(),
      }));
    if (recovered) return;
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error);
    if (error instanceof PermanentChannelError || claim.attempts >= 5) {
      await repository.failPartForLease({
        jobId,
        part,
        leaseId: claim.leaseId,
        error: claim.attempts >= 5 ? "attempts_exhausted" : message,
        now: new Date().toISOString(),
      });
      if (!(error instanceof PermanentChannelError)) {
        throw new PermanentChannelError("Contact import attempts exhausted");
      }
    } else {
      await repository.returnPartToPending({
        jobId,
        part,
        leaseId: claim.leaseId,
        error: message,
        now: new Date().toISOString(),
      });
    }
    throw error;
  }
}

export async function publishContactImportReconciliation(
  repository: ContactImportReconciliationRepository,
  reconciliation: ContactImportReconciliation,
  queue: Queue,
): Promise<void> {
  await enqueueSegmentContactReconciliation(
    queue,
    reconciliation.workspaceId,
    reconciliation.contactIds,
  );
  await repository.markPublished(
    reconciliation.jobId,
    reconciliation.part,
    new Date().toISOString(),
  );
}

function normalizeImportRows(lines: readonly string[]): ContactImportRow[] {
  const rows: ContactImportRow[] = [];
  for (const line of lines) {
    try {
      const source = parseJsonRecord(line);
      const email =
        typeof source["email"] === "string" && source["email"].trim()
          ? source["email"].trim().toLowerCase()
          : null;
      const externalId =
        typeof source["external_id"] === "string" && source["external_id"].trim()
          ? source["external_id"].trim()
          : null;
      if (!email && !externalId) continue;
      const customFields = { ...source };
      for (const key of ["email", "external_id", "first_name", "last_name", "phone", "stage"]) {
        delete customFields[key];
      }
      rows.push({
        email,
        externalId,
        firstName: stringValue(source["first_name"]),
        lastName: stringValue(source["last_name"]),
        phone: stringValue(source["phone"]),
        stage: stringValue(source["stage"]) ?? "lead",
        customFields,
      });
    } catch {
      // The manifest's processed count retains malformed rows as failures.
    }
  }
  return rows;
}

export async function processContactExport(jobId: string, env: RuntimeEnv): Promise<void> {
  const repository = new DataJobWorkerRepository(createDatabase(env.DB));
  const claimTime = new Date().toISOString();
  const job = await repository.claimExportJob({
    jobId,
    now: claimTime,
    leaseExpiresAt: new Date(new Date(claimTime).getTime() + 5 * 60_000).toISOString(),
  });
  if (!job) return;
  try {
    if (job.attempts > 5) {
      throw new PermanentChannelError("Contact export attempts exhausted");
    }
    const lastId = typeof job.cursor["lastId"] === "string" ? job.cursor["lastId"] : "";
    const partNumber = typeof job.cursor["partNumber"] === "number" ? job.cursor["partNumber"] : 0;
    const filter = contactExportFilterSchema.parse(job.cursor["filter"] ?? {});
    const batchSize = 1_000;
    const contacts = await repository.listContactsForExport(
      job.workspaceId,
      filter,
      lastId,
      batchSize,
    );
    if (contacts.length > 0) {
      const body =
        (partNumber === 0 ? CONTACT_EXPORT_HEADER : "") +
        contacts
          .map((contact) =>
            [
              contact.id,
              contact.email,
              contact.firstName,
              contact.lastName,
              contact.phone,
              contact.externalId,
              contact.stage,
              contact.score,
              contact.status,
              contact.customFields,
              contact.createdAt,
              contact.updatedAt,
            ]
              .map(csvCell)
              .join(","),
          )
          .join("\n") +
        "\n";
      await env.ASSETS_BUCKET.put(`${job.r2Key}.parts/${partNumber}.csv`, body, {
        httpMetadata: { contentType: "text/csv; charset=utf-8" },
      });
    }
    const last = contacts.at(-1);
    const nextCursor = {
      partNumber: partNumber + (contacts.length > 0 ? 1 : 0),
      lastId: last?.id ?? lastId,
      filter,
    };
    if (contacts.length === batchSize) {
      const advanced = await repository.recordExportProgress({
        jobId,
        leaseId: job.leaseId,
        cursor: nextCursor,
        count: contacts.length,
        now: new Date().toISOString(),
      });
      requireExportLease(advanced, "recording progress");
      await env.JOBS_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
      return;
    }
    const chunks: BlobPart[] = [];
    if (partNumber === 0 && contacts.length === 0) chunks.push(CONTACT_EXPORT_HEADER);
    for (let index = 0; index < nextCursor.partNumber; index += 1) {
      const part = await env.ASSETS_BUCKET.get(`${job.r2Key}.parts/${index}.csv`);
      if (!part) throw new PermanentChannelError(`Export part ${index} is missing`);
      chunks.push(await part.arrayBuffer());
    }
    await env.ASSETS_BUCKET.put(job.r2Key, new Blob(chunks), {
      httpMetadata: {
        contentType: "text/csv; charset=utf-8",
        contentDisposition: `attachment; filename="openengage-contacts-${jobId}.csv"`,
      },
    });
    const completed = await repository.completeExportForLease({
      jobId,
      leaseId: job.leaseId,
      cursor: nextCursor,
      count: contacts.length,
      attempts: job.attempts,
      now: new Date().toISOString(),
    });
    requireExportLease(completed, "completing");
  } catch (error) {
    if (error instanceof ContactExportLeaseLostError) throw error;
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error);
    const terminal = error instanceof PermanentChannelError || job.attempts >= 5;
    const now = new Date().toISOString();
    if (terminal) {
      const failed = await repository.failExportForLease({
        jobId,
        leaseId: job.leaseId,
        error:
          job.attempts >= 5 && !(error instanceof PermanentChannelError)
            ? `Contact export attempts exhausted: ${message}`
            : message,
        now,
      });
      requireExportLease(failed, "recording terminal failure");
      if (!(error instanceof PermanentChannelError)) {
        throw new PermanentChannelError("Contact export attempts exhausted");
      }
    } else {
      const returned = await repository.returnExportToPending({
        jobId,
        leaseId: job.leaseId,
        error: message,
        now,
      });
      requireExportLease(returned, "returning to pending");
    }
    throw error;
  }
}

class ContactExportLeaseLostError extends TransientChannelError {
  public override readonly name = "ContactExportLeaseLostError";
}

function requireExportLease(updated: boolean, operation: string): void {
  if (!updated) {
    throw new ContactExportLeaseLostError(`Contact export lease lost while ${operation}`);
  }
}

const CONTACT_EXPORT_HEADER =
  "id,email,first_name,last_name,phone,external_id,stage,score,status,custom_fields,created_at,updated_at\n";

export function csvCell(value: unknown): string {
  let rendered =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}
