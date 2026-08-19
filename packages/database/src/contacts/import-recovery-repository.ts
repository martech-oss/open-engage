import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { ContactImportPartExecutionRepository } from "./import-part-execution-repository";
import {
  activeImportJob,
  type ContactImportCandidateManifest,
  databaseTimestamp,
  decodeCandidateManifest,
  expiredImportPartLease,
  IMPORT_ATTEMPT_LIMIT,
  liveImportPartLease,
} from "./import-part-state";
import { contactImportParts, importJobs } from "./schema";

const IMPORT_SCAN_LIMIT = 100;

export type { ContactImportCandidate, ContactImportCandidateManifest } from "./import-part-state";

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
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
          or(
            eq(contactImportParts.status, "pending"),
            and(
              eq(contactImportParts.status, "processing"),
              lte(contactImportParts.leaseExpiresAt, databaseTimestamp()),
            ),
          ),
          exists(
            this.database.orm
              .select({ value: sql<number>`1` })
              .from(importJobs)
              .where(activeImportJob(input.jobId)),
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
              .where(liveImportPartLease(input.jobId, input.part, leaseId)),
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
          liveImportPartLease(input.jobId, input.part, input.leaseId),
          lt(contactImportParts.attempts, IMPORT_ATTEMPT_LIMIT),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
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
    return this.failPart(input, "live");
  }

  private async failPart(
    input: {
      jobId: string;
      part: number;
      leaseId: string;
      error: string;
      now: string;
    },
    authority: "live" | "expired",
  ): Promise<boolean> {
    const leaseAuthority =
      authority === "live"
        ? liveImportPartLease(input.jobId, input.part, input.leaseId)
        : expiredImportPartLease(input.jobId, input.part, input.leaseId);
    const orm = this.database.orm;
    const terminalPart = and(
      eq(contactImportParts.jobId, input.jobId),
      eq(contactImportParts.part, input.part),
      eq(contactImportParts.status, "failed"),
      eq(contactImportParts.lastError, input.error),
      eq(contactImportParts.updatedAt, input.now),
    );
    const [partResult, jobResult] = await orm.batch([
      orm
        .update(contactImportParts)
        .set({
          status: "failed",
          leaseId: null,
          leaseExpiresAt: null,
          lastError: input.error,
          updatedAt: input.now,
        })
        .where(
          and(
            leaseAuthority,
            isNull(contactImportParts.insertPhaseToken),
            isNull(contactImportParts.reconciliationContactIds),
          ),
        ),
      orm
        .update(importJobs)
        .set({ status: "failed", updatedAt: input.now })
        .where(
          and(
            activeImportJob(input.jobId),
            exists(
              orm
                .select({ value: sql<number>`1` })
                .from(contactImportParts)
                .where(terminalPart),
            ),
          ),
        ),
    ]);
    return changedExactlyOne(jobResult) && changedExactlyOne(partResult);
  }

  public async recoverExpiredParts(now: string): Promise<void> {
    const expired = await this.database.orm
      .select({
        jobId: contactImportParts.jobId,
        part: contactImportParts.part,
        totalParts: contactImportParts.totalParts,
        attempts: contactImportParts.attempts,
        leaseId: contactImportParts.leaseId,
      })
      .from(contactImportParts)
      .where(
        and(
          eq(contactImportParts.status, "processing"),
          lte(contactImportParts.leaseExpiresAt, databaseTimestamp()),
        ),
      )
      .limit(IMPORT_SCAN_LIMIT);
    const execution = new ContactImportPartExecutionRepository(this.database);
    for (const part of expired) {
      if (!part.leaseId) continue;
      const completed = await execution.completePersistedPartForExpiredLease({
        jobId: part.jobId,
        part: part.part,
        totalParts: part.totalParts,
        leaseId: part.leaseId,
        now,
      });
      if (completed) continue;
      if (part.attempts >= IMPORT_ATTEMPT_LIMIT) {
        await this.failPart(
          {
            jobId: part.jobId,
            part: part.part,
            leaseId: part.leaseId,
            error: "attempts_exhausted",
            now,
          },
          "expired",
        );
      } else {
        await this.returnExpiredPartToPending({
          jobId: part.jobId,
          part: part.part,
          leaseId: part.leaseId,
          error: "lease_expired",
          now,
        });
      }
    }
  }

  private async returnExpiredPartToPending(input: {
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
          expiredImportPartLease(input.jobId, input.part, input.leaseId),
          lt(contactImportParts.attempts, IMPORT_ATTEMPT_LIMIT),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
        ),
      );
    return changedExactlyOne(result);
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
      .where(
        and(
          eq(contactImportParts.status, "pending"),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
          inArray(importJobs.status, ["pending", "processing"]),
        ),
      )
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
    const phase = await this.database.orm
      .select({ leaseId: contactImportParts.leaseId })
      .from(contactImportParts)
      .where(
        and(
          eq(contactImportParts.jobId, input.jobId),
          eq(contactImportParts.part, input.part),
          eq(contactImportParts.totalParts, input.totalParts),
          eq(contactImportParts.status, "processing"),
          isNotNull(contactImportParts.leaseId),
          isNotNull(contactImportParts.insertPhaseToken),
          isNotNull(contactImportParts.reconciliationContactIds),
        ),
      )
      .get();
    if (phase?.leaseId) {
      const execution = new ContactImportPartExecutionRepository(this.database);
      const completion = {
        jobId: input.jobId,
        part: input.part,
        totalParts: input.totalParts,
        leaseId: phase.leaseId,
        now: input.now,
      };
      const completed =
        (await execution.completePersistedPartForLiveLease(completion)) ||
        (await execution.completePersistedPartForExpiredLease(completion));
      if (completed) return;
    }
    const eligible = and(
      eq(contactImportParts.jobId, input.jobId),
      eq(contactImportParts.part, input.part),
      eq(contactImportParts.totalParts, input.totalParts),
      ne(contactImportParts.status, "completed"),
      isNull(contactImportParts.insertPhaseToken),
      isNull(contactImportParts.reconciliationContactIds),
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
