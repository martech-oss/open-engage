import { and, asc, eq, exists, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import type { ContactImportRow } from "./data-job-repository";
import { contactImportParts, contacts, importJobs } from "./schema";

const IMPORT_ATTEMPT_LIMIT = 5;
const IMPORT_SCAN_LIMIT = 100;

export interface ContactImportCandidate {
  id: string;
  row: ContactImportRow;
}

interface ContactImportCandidateManifest {
  processed: number;
  candidates: ContactImportCandidate[];
}

export type ImportPartClaim =
  | { kind: "missing" | "unavailable" }
  | { kind: "manifest_mismatch" }
  | {
      kind: "claimed";
      workspaceId: string;
      r2Key: string;
      leaseId: string;
      attempts: number;
      candidates: ContactImportCandidateManifest | null;
    };

/** Recovery-safe state transitions for contact-import queue work. */
export class ContactImportRecoveryRepository extends DatabaseRepository {
  public async findJobWorkspace(jobId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ workspaceId: importJobs.workspaceId })
      .from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.kind, "contact_import")))
      .get();
    return row?.workspaceId ?? null;
  }

  public async claimPart(input: {
    jobId: string;
    part: number;
    totalParts: number;
    now: string;
    leaseExpiresAt: string;
  }): Promise<ImportPartClaim> {
    const state = await this.database.orm
      .select({
        workspaceId: importJobs.workspaceId,
        r2Key: importJobs.r2Key,
        jobKind: importJobs.kind,
        jobStatus: importJobs.status,
        partStatus: contactImportParts.status,
        storedTotalParts: contactImportParts.totalParts,
      })
      .from(importJobs)
      .leftJoin(
        contactImportParts,
        and(eq(contactImportParts.jobId, importJobs.id), eq(contactImportParts.part, input.part)),
      )
      .where(eq(importJobs.id, input.jobId))
      .get();
    if (!state || state.jobKind !== "contact_import") return { kind: "missing" };
    if (state.storedTotalParts === null || state.storedTotalParts !== input.totalParts) {
      return { kind: "manifest_mismatch" };
    }
    if (["completed", "failed"].includes(state.jobStatus) || state.partStatus === "completed") {
      return { kind: "unavailable" };
    }

    const leaseId = uuidv7();
    const [claimed] = await this.database.orm
      .update(contactImportParts)
      .set({
        status: "processing",
        attempts: sql`${contactImportParts.attempts} + 1`,
        leaseId,
        leaseExpiresAt: input.leaseExpiresAt,
        lastError: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(contactImportParts.jobId, input.jobId),
          eq(contactImportParts.part, input.part),
          eq(contactImportParts.totalParts, input.totalParts),
          lt(contactImportParts.attempts, IMPORT_ATTEMPT_LIMIT),
          or(
            eq(contactImportParts.status, "pending"),
            and(
              eq(contactImportParts.status, "processing"),
              lte(contactImportParts.leaseExpiresAt, input.now),
            ),
          ),
        ),
      )
      .returning({
        attempts: contactImportParts.attempts,
        candidates: contactImportParts.candidates,
      });
    if (!claimed) return { kind: "unavailable" };
    await this.database.orm
      .update(importJobs)
      .set({ status: "processing", updatedAt: input.now })
      .where(
        and(
          eq(importJobs.id, input.jobId),
          eq(importJobs.kind, "contact_import"),
          inArray(importJobs.status, ["pending", "processing"]),
          exists(
            this.database.orm
              .select({ value: sql<number>`1` })
              .from(contactImportParts)
              .where(exactPartLease(input.jobId, input.part, leaseId)),
          ),
        ),
      );
    return {
      kind: "claimed",
      workspaceId: state.workspaceId,
      r2Key: state.r2Key,
      leaseId,
      attempts: claimed.attempts,
      candidates: claimed.candidates ? decodeCandidateManifest(claimed.candidates) : null,
    };
  }

  public async reserveCandidates(input: {
    jobId: string;
    part: number;
    leaseId: string;
    processed: number;
    rows: ContactImportRow[];
  }): Promise<ContactImportCandidateManifest | null> {
    const proposed: ContactImportCandidateManifest = {
      processed: input.processed,
      candidates: input.rows.map((row) => ({ id: uuidv7(), row })),
    };
    await this.database.orm
      .update(contactImportParts)
      .set({ candidates: JSON.stringify(proposed), updatedAt: nowIso() })
      .where(
        and(
          exactPartLease(input.jobId, input.part, input.leaseId),
          isNull(contactImportParts.candidates),
        ),
      );
    const row = await this.database.orm
      .select({ candidates: contactImportParts.candidates })
      .from(contactImportParts)
      .where(exactPartLease(input.jobId, input.part, input.leaseId))
      .get();
    return row?.candidates ? decodeCandidateManifest(row.candidates) : null;
  }

  /**
   * Inserts reserved candidates and returns only ids proven to belong to this
   * part: ids returned now plus reserved ids already visible after an
   * ambiguous prior insert commit.
   */
  public async insertReservedCandidates(
    workspaceId: string,
    candidates: readonly ContactImportCandidate[],
  ): Promise<string[]> {
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((candidate) => candidate.id);
    const existing = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, candidateIds)));
    const owned = new Set(existing.map((row) => row.id));
    const remaining = candidates.filter((candidate) => !owned.has(candidate.id));
    if (remaining.length > 0) {
      const now = nowIso();
      const [first, ...rest] = remaining.map(({ id, row }) =>
        this.database.orm
          .insert(contacts)
          .values({
            id,
            workspaceId,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
            externalId: row.externalId,
            stage: row.stage,
            score: 0,
            status: "active",
            customFields: JSON.stringify(row.customFields),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: contacts.id }),
      );
      if (first) {
        const results = await this.database.orm.batch([first, ...rest]);
        for (const result of results) {
          for (const row of result as Array<{ id: string }>) owned.add(row.id);
        }
      }
    }
    return candidateIds.filter((id) => owned.has(id));
  }

  public async completePart(input: {
    jobId: string;
    part: number;
    totalParts: number;
    leaseId: string;
    processed: number;
    succeeded: number;
    failed: number;
    now: string;
  }): Promise<boolean> {
    const finished = input.part + 1 === input.totalParts;
    const exactLease = exactPartLease(input.jobId, input.part, input.leaseId);
    const guardedJob = and(
      eq(importJobs.id, input.jobId),
      exists(
        this.database.orm
          .select({ value: sql<number>`1` })
          .from(contactImportParts)
          .where(exactLease),
      ),
    );
    const orm = this.database.orm;
    const jobUpdate = orm
      .update(importJobs)
      .set({
        status: finished ? "completed" : "processing",
        cursor: JSON.stringify({ part: input.part + 1, totalParts: input.totalParts }),
        processed: sql`${importJobs.processed} + ${input.processed}`,
        succeeded: sql`${importJobs.succeeded} + ${input.succeeded}`,
        failed: sql`${importJobs.failed} + ${input.failed}`,
        updatedAt: input.now,
      })
      .where(guardedJob);
    const partUpdate = orm
      .update(contactImportParts)
      .set({
        status: "completed",
        processed: input.processed,
        succeeded: input.succeeded,
        failed: input.failed,
        leaseId: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        updatedAt: input.now,
      })
      .where(exactLease);
    const results = finished
      ? await orm.batch([jobUpdate, partUpdate])
      : await orm.batch([
          jobUpdate,
          orm
            .insert(contactImportParts)
            .select(
              orm
                .select({
                  jobId: contactImportParts.jobId,
                  part: sql<number>`${input.part + 1}`.as("part"),
                  totalParts: contactImportParts.totalParts,
                  status: sql<string>`'pending'`.as("status"),
                  attempts: sql<number>`0`.as("attempts"),
                  leaseId: sql<string | null>`NULL`.as("lease_id"),
                  leaseExpiresAt: sql<string | null>`NULL`.as("lease_expires_at"),
                  candidates: sql<string | null>`NULL`.as("candidates"),
                  processed: sql<number>`0`.as("processed"),
                  succeeded: sql<number>`0`.as("succeeded"),
                  failed: sql<number>`0`.as("failed"),
                  lastError: sql<string | null>`NULL`.as("last_error"),
                  createdAt: sql<string>`${input.now}`.as("created_at"),
                  updatedAt: sql<string>`${input.now}`.as("updated_at"),
                  completedAt: sql<string | null>`NULL`.as("completed_at"),
                })
                .from(contactImportParts)
                .where(exactLease),
            )
            .onConflictDoNothing(),
          partUpdate,
        ]);
    return changedExactlyOne(results[0] as D1Result);
  }

  public async returnPartToPending(input: {
    jobId: string;
    part: number;
    leaseId: string;
    error: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .update(contactImportParts)
      .set({
        status: "pending",
        leaseId: null,
        leaseExpiresAt: null,
        lastError: input.error,
        updatedAt: input.now,
      })
      .where(
        and(
          exactPartLease(input.jobId, input.part, input.leaseId),
          lt(contactImportParts.attempts, IMPORT_ATTEMPT_LIMIT),
        ),
      );
    return changedExactlyOne(result);
  }

  public async failPartForLease(input: {
    jobId: string;
    part: number;
    leaseId: string;
    error: string;
    now: string;
  }): Promise<boolean> {
    const exactLease = exactPartLease(input.jobId, input.part, input.leaseId);
    const orm = this.database.orm;
    const [jobResult, partResult] = await orm.batch([
      orm
        .update(importJobs)
        .set({ status: "failed", updatedAt: input.now })
        .where(
          and(
            eq(importJobs.id, input.jobId),
            exists(
              orm
                .select({ value: sql<number>`1` })
                .from(contactImportParts)
                .where(exactLease),
            ),
          ),
        ),
      orm
        .update(contactImportParts)
        .set({
          status: "failed",
          leaseId: null,
          leaseExpiresAt: null,
          lastError: input.error,
          updatedAt: input.now,
        })
        .where(exactLease),
    ]);
    return changedExactlyOne(jobResult) && changedExactlyOne(partResult);
  }

  public async recoverExpiredParts(now: string): Promise<void> {
    const expired = await this.database.orm
      .select({
        jobId: contactImportParts.jobId,
        part: contactImportParts.part,
        attempts: contactImportParts.attempts,
        leaseId: contactImportParts.leaseId,
      })
      .from(contactImportParts)
      .where(
        and(
          eq(contactImportParts.status, "processing"),
          lte(contactImportParts.leaseExpiresAt, now),
        ),
      )
      .limit(IMPORT_SCAN_LIMIT);
    for (const part of expired) {
      if (!part.leaseId) continue;
      if (part.attempts >= IMPORT_ATTEMPT_LIMIT) {
        await this.failPartForLease({
          jobId: part.jobId,
          part: part.part,
          leaseId: part.leaseId,
          error: "attempts_exhausted",
          now,
        });
      } else {
        await this.returnPartToPending({
          jobId: part.jobId,
          part: part.part,
          leaseId: part.leaseId,
          error: "lease_expired",
          now,
        });
      }
    }
  }

  public async scanPendingParts(): Promise<
    Array<{ importJobId: string; part: number; totalParts: number }>
  > {
    return this.database.orm
      .select({
        importJobId: contactImportParts.jobId,
        part: contactImportParts.part,
        totalParts: contactImportParts.totalParts,
      })
      .from(contactImportParts)
      .innerJoin(importJobs, eq(importJobs.id, contactImportParts.jobId))
      .where(and(eq(contactImportParts.status, "pending"), ne(importJobs.status, "failed")))
      .orderBy(asc(contactImportParts.updatedAt), asc(contactImportParts.jobId))
      .limit(IMPORT_SCAN_LIMIT);
  }

  public async failPartFromDeadLetter(input: {
    jobId: string;
    part: number;
    totalParts: number;
    error: string;
    now: string;
  }): Promise<void> {
    const eligible = and(
      eq(contactImportParts.jobId, input.jobId),
      eq(contactImportParts.part, input.part),
      eq(contactImportParts.totalParts, input.totalParts),
      ne(contactImportParts.status, "completed"),
    );
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(importJobs)
        .set({ status: "failed", updatedAt: input.now })
        .where(
          and(
            eq(importJobs.id, input.jobId),
            exists(
              orm
                .select({ value: sql<number>`1` })
                .from(contactImportParts)
                .where(eligible),
            ),
          ),
        ),
      orm
        .update(contactImportParts)
        .set({
          status: "failed",
          leaseId: null,
          leaseExpiresAt: null,
          lastError: input.error,
          updatedAt: input.now,
        })
        .where(eligible),
    ]);
  }
}

function exactPartLease(jobId: string, part: number, leaseId: string) {
  return and(
    eq(contactImportParts.jobId, jobId),
    eq(contactImportParts.part, part),
    eq(contactImportParts.status, "processing"),
    eq(contactImportParts.leaseId, leaseId),
  );
}

function decodeCandidateManifest(value: string): ContactImportCandidateManifest {
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
