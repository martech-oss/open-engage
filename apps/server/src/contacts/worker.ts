import {
  ContactImportPartExecutionRepository,
  ContactImportRecoveryRepository,
  ContactImportReconciliationRepository,
  createDatabase,
  DataJobWorkerRepository,
  type ContactImportReconciliation,
  type ContactImportRow,
} from "@openengage/database";

import { PermanentChannelError } from "../channels";
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
  const job = await repository.claimExportJob(jobId);
  if (!job) return;
  const lastId = typeof job.cursor["lastId"] === "string" ? job.cursor["lastId"] : "";
  const partNumber = typeof job.cursor["partNumber"] === "number" ? job.cursor["partNumber"] : 0;
  const batchSize = 1_000;
  const contacts = await repository.listContactsForExport(job.workspaceId, lastId, batchSize);
  if (contacts.length > 0) {
    const header =
      partNumber === 0
        ? "id,email,first_name,last_name,phone,external_id,stage,score,status,custom_fields,created_at,updated_at\n"
        : "";
    const body =
      header +
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
    const last = contacts.at(-1);
    await repository.recordExportProgress(jobId, {
      cursor: { partNumber: partNumber + 1, lastId: last?.id ?? lastId },
      count: contacts.length,
    });
  }
  if (contacts.length === batchSize) {
    await env.JOBS_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
    return;
  }
  const chunks: ArrayBuffer[] = [];
  for (let index = 0; index < partNumber + (contacts.length > 0 ? 1 : 0); index += 1) {
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
  await repository.markCompleted(jobId);
}

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
