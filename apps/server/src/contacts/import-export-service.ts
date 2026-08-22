import {
  contactExportFilterSchema,
  type ContactDataJob,
  type ContactExportFilter,
} from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { DataJobRepository } from "@openengage/database/contacts";
import { uuidv7 } from "@openengage/database/shared";

import { parseCsv } from "./csv";

interface ImportDeps {
  bucket: R2Bucket;
  queue: Queue;
}

export type ContactImportOutcome =
  | { kind: "identifier_missing" }
  | { kind: "started"; jobId: string; rows: number; parts: number };

export async function startContactImport(
  database: OpenEngageDatabase,
  deps: ImportDeps,
  workspace: WorkspaceContext,
  csvText: string,
): Promise<ContactImportOutcome> {
  const rows = parseCsv(csvText);
  const header = rows.shift()?.map((value) => value.trim().toLowerCase());
  if (!header?.includes("email") && !header?.includes("external_id")) {
    return { kind: "identifier_missing" };
  }
  const jobId = uuidv7();
  const baseKey = `${workspace.workspaceId}/imports/${jobId}`;
  const partSize = 100;
  const parts: string[] = [];
  for (let offset = 0; offset < rows.length; offset += partSize) {
    const part = rows.slice(offset, offset + partSize).map((values) => {
      const record: Record<string, string> = {};
      for (const [index, name] of header.entries()) {
        if (name) record[name] = values[index] ?? "";
      }
      return JSON.stringify(record);
    });
    parts.push(part.join("\n"));
  }
  for (let offset = 0; offset < parts.length; offset += 20) {
    await Promise.all(
      parts.slice(offset, offset + 20).map((part, relativeIndex) => {
        const index = offset + relativeIndex;
        return deps.bucket.put(`${baseKey}/part-${index}.ndjson`, part, {
          httpMetadata: { contentType: "application/x-ndjson" },
        });
      }),
    );
  }
  await deps.bucket.put(
    `${baseKey}/manifest.json`,
    JSON.stringify({ header, parts: parts.length, rows: rows.length }),
    { httpMetadata: { contentType: "application/json" } },
  );
  const repository = new DataJobRepository(database, workspace);
  await repository.createJob({
    id: jobId,
    kind: "contact_import",
    r2Key: baseKey,
    cursor: { totalParts: parts.length },
  });
  if (parts.length > 0) {
    await deps.queue.send({
      kind: "contact_import",
      importJobId: jobId,
      part: 0,
      totalParts: parts.length,
    });
  } else {
    await repository.markCompleted(jobId);
  }
  return { kind: "started", jobId, rows: rows.length, parts: parts.length };
}

export async function startContactExport(
  database: OpenEngageDatabase,
  queue: Queue,
  workspace: WorkspaceContext,
  input?: { filter?: ContactExportFilter | undefined },
): Promise<{ jobId: string }> {
  const jobId = uuidv7();
  const key = `${workspace.workspaceId}/exports/contacts-${jobId}.csv`;
  const filter = contactExportFilterSchema.parse(input?.filter ?? {});
  await new DataJobRepository(database, workspace).createJob({
    id: jobId,
    kind: "contact_export",
    r2Key: key,
    cursor: { partNumber: 0, lastId: "", filter },
  });
  await queue.send({ kind: "contact_export", exportJobId: jobId });
  return { jobId };
}

export async function getDataJob(
  database: OpenEngageDatabase,
  workspaceId: string,
  jobId: string,
): Promise<ContactDataJob | null> {
  const row = await new DataJobRepository(database, { workspaceId }).getDataJob(jobId);
  if (!row) return null;
  return { ...row, kind: row.kind as ContactDataJob["kind"] };
}

export type ExportDownloadOutcome =
  | { kind: "not_ready" }
  | { kind: "missing" }
  | { kind: "ready"; file: File };

export async function getContactExportFile(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspaceId: string,
  jobId: string,
): Promise<ExportDownloadOutcome> {
  const job = await new DataJobRepository(database, { workspaceId }).getExportJob(jobId);
  if (!job || job.status !== "completed") return { kind: "not_ready" };
  const object = await bucket.get(job.r2Key);
  if (!object) return { kind: "missing" };
  const bytes = await object.arrayBuffer();
  return {
    kind: "ready",
    file: new File([bytes], `openengage-contacts-${jobId}.csv`, { type: "text/csv" }),
  };
}
