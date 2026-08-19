import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";

import type { ContactImportRow } from "./data-job-repository";
import { contactImportParts, importJobs } from "./schema";

export const IMPORT_ATTEMPT_LIMIT = 5;

export interface ContactImportCandidate {
  id: string;
  row: ContactImportRow;
}

export interface ContactImportCandidateManifest {
  processed: number;
  candidates: ContactImportCandidate[];
}

/** ISO timestamp evaluated by SQLite/D1 when the authority statement executes. */
export function databaseTimestamp() {
  return sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
}

export function exactImportPartLease(jobId: string, part: number, leaseId: string) {
  return and(
    eq(contactImportParts.jobId, jobId),
    eq(contactImportParts.part, part),
    eq(contactImportParts.status, "processing"),
    eq(contactImportParts.leaseId, leaseId),
  );
}

export function exactImportInsertPhase(
  jobId: string,
  part: number,
  leaseId: string,
  insertPhaseToken: string,
) {
  return and(
    exactImportPartLease(jobId, part, leaseId),
    eq(contactImportParts.insertPhaseToken, insertPhaseToken),
  );
}

export function liveImportPartLease(jobId: string, part: number, leaseId: string) {
  return and(
    exactImportPartLease(jobId, part, leaseId),
    gt(contactImportParts.leaseExpiresAt, databaseTimestamp()),
    sql`EXISTS (
      SELECT 1 FROM ${importJobs}
      WHERE ${activeImportJob(jobId)}
    )`,
  );
}

export function expiredImportPartLease(jobId: string, part: number, leaseId: string) {
  return and(
    exactImportPartLease(jobId, part, leaseId),
    lte(contactImportParts.leaseExpiresAt, databaseTimestamp()),
    sql`EXISTS (
      SELECT 1 FROM ${importJobs}
      WHERE ${activeImportJob(jobId)}
    )`,
  );
}

export function activeImportJob(jobId: string) {
  return and(
    eq(importJobs.id, jobId),
    eq(importJobs.kind, "contact_import"),
    inArray(importJobs.status, ["pending", "processing"]),
  );
}

export function decodeCandidateManifest(value: string): ContactImportCandidateManifest {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("processed" in parsed) ||
    typeof parsed.processed !== "number" ||
    !("candidates" in parsed) ||
    !Array.isArray(parsed.candidates)
  ) {
    throw new Error("contact_import_parts.candidates is malformed");
  }
  return parsed as ContactImportCandidateManifest;
}

export function decodeReconciliationContactIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
    throw new Error("contact_import_parts.reconciliation_contact_ids is malformed");
  }
  return parsed;
}
