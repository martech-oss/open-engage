import { and, eq, exists, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import type { ContactImportRow } from "./data-job-repository";
import {
  activeImportJob,
  type ContactImportCandidate,
  type ContactImportCandidateManifest,
  decodeCandidateManifest,
  decodeReconciliationContactIds,
  exactImportInsertPhase,
  expiredImportPartLease,
  liveImportPartLease,
} from "./import-part-state";
import { contactImportParts, contacts, importJobs } from "./schema";

type CompletionAuthority = "live" | "expired";

/** Candidate insertion and exact-once completion for one claimed import part. */
export class ContactImportPartExecutionRepository extends DatabaseRepository {
  public async reserveCandidates(input: {
    jobId: string;
    part: number;
    leaseId: string;
    now: string;
    processed: number;
    rows: ContactImportRow[];
  }): Promise<ContactImportCandidateManifest | null> {
    const proposed: ContactImportCandidateManifest = {
      processed: input.processed,
      candidates: input.rows.map((row) => ({ id: uuidv7(), row })),
    };
    await this.database.orm
      .update(contactImportParts)
      .set({ candidates: JSON.stringify(proposed), updatedAt: input.now })
      .where(
        and(
          liveImportPartLease(input.jobId, input.part, input.leaseId),
          isNull(contactImportParts.candidates),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
        ),
      );
    const row = await this.database.orm
      .select({ candidates: contactImportParts.candidates })
      .from(contactImportParts)
      .where(
        and(
          liveImportPartLease(input.jobId, input.part, input.leaseId),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
        ),
      )
      .get();
    return row?.candidates ? decodeCandidateManifest(row.candidates) : null;
  }

  /**
   * Inserts reserved candidates and persists the verified ids in the same D1
   * batch. A non-null JSON value, including `[]`, proves the phase committed.
   */
  public async persistCandidateInsertPhase(input: {
    jobId: string;
    part: number;
    leaseId: string;
    workspaceId: string;
    now: string;
    candidates: readonly ContactImportCandidate[];
  }): Promise<void> {
    const orm = this.database.orm;
    const candidateIds = input.candidates.map((candidate) => candidate.id);
    const insertPhaseToken = uuidv7();
    const matchingWorkspace = exists(
      orm
        .select({ value: sql<number>`1` })
        .from(importJobs)
        .where(and(activeImportJob(input.jobId), eq(importJobs.workspaceId, input.workspaceId))),
    );
    const acquirePhase = orm
      .update(contactImportParts)
      .set({ insertPhaseToken, updatedAt: input.now })
      .where(
        and(
          liveImportPartLease(input.jobId, input.part, input.leaseId),
          isNotNull(contactImportParts.candidates),
          isNull(contactImportParts.insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
          matchingWorkspace,
        ),
      );
    const phaseIsOwned = exists(
      orm
        .select({ value: sql<number>`1` })
        .from(contactImportParts)
        .where(exactImportInsertPhase(input.jobId, input.part, input.leaseId, insertPhaseToken)),
    );
    const inserts = input.candidates.map(({ id, row }) =>
      orm
        .insert(contacts)
        .select(
          sql`SELECT
            ${id}, ${input.workspaceId}, NULL, ${row.email}, ${row.firstName}, ${row.lastName},
            ${row.phone}, ${row.externalId}, ${row.stage}, 0, 0, 'active',
            ${JSON.stringify(row.customFields)}, ${input.now}, ${input.now}, NULL
          WHERE ${phaseIsOwned}`,
        )
        .onConflictDoNothing(),
    );
    const verifiedIds =
      candidateIds.length === 0
        ? sql<string>`'[]'`
        : sql<string>`(
            SELECT COALESCE(json_group_array(id), '[]')
            FROM (
              SELECT ${contacts.id} AS id
              FROM ${contacts}
              WHERE ${contacts.workspaceId} = ${input.workspaceId}
                AND ${inArray(contacts.id, candidateIds)}
              ORDER BY ${contacts.id}
            )
          )`;
    const phaseUpdate = orm
      .update(contactImportParts)
      .set({ reconciliationContactIds: verifiedIds, updatedAt: input.now })
      .where(
        and(
          exactImportInsertPhase(input.jobId, input.part, input.leaseId, insertPhaseToken),
          isNull(contactImportParts.reconciliationContactIds),
        ),
      );
    const statements: BatchItem<"sqlite">[] = [acquirePhase, ...inserts, phaseUpdate];
    await orm.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  public completePersistedPartForLiveLease(input: CompletionInput): Promise<boolean> {
    return this.completePersistedPart(input, "live");
  }

  public completePersistedPartForExpiredLease(input: CompletionInput): Promise<boolean> {
    return this.completePersistedPart(input, "expired");
  }

  private async completePersistedPart(
    input: CompletionInput,
    authority: CompletionAuthority,
  ): Promise<boolean> {
    const leaseAuthority = this.leaseAuthority(input, authority);
    const phase = await this.database.orm
      .select({
        candidates: contactImportParts.candidates,
        contactIds: contactImportParts.reconciliationContactIds,
      })
      .from(contactImportParts)
      .where(
        and(
          leaseAuthority,
          eq(contactImportParts.totalParts, input.totalParts),
          isNotNull(contactImportParts.candidates),
          isNotNull(contactImportParts.insertPhaseToken),
          isNotNull(contactImportParts.reconciliationContactIds),
          isNull(contactImportParts.completionToken),
        ),
      )
      .get();
    if (!phase?.candidates || phase.contactIds === null) return false;
    const manifest = decodeCandidateManifest(phase.candidates);
    const contactIds = decodeReconciliationContactIds(phase.contactIds);
    const candidateIds = new Set(manifest.candidates.map((candidate) => candidate.id));
    if (contactIds.some((id) => !candidateIds.has(id)) || contactIds.length > manifest.processed) {
      throw new Error("contact import insert-phase evidence is inconsistent");
    }
    const completionToken = uuidv7();
    return this.completePart(
      input,
      authority,
      completionToken,
      manifest.processed,
      contactIds.length,
      manifest.processed - contactIds.length,
      contactIds.length === 0,
    );
  }

  private async completePart(
    input: CompletionInput,
    authority: CompletionAuthority,
    completionToken: string,
    processed: number,
    succeeded: number,
    failed: number,
    reconciliationIsEmpty: boolean,
  ): Promise<boolean> {
    const finished = input.part + 1 === input.totalParts;
    const leaseAuthority = this.leaseAuthority(input, authority);
    const phaseIsAuthorized = and(
      leaseAuthority,
      eq(contactImportParts.totalParts, input.totalParts),
      isNotNull(contactImportParts.candidates),
      isNotNull(contactImportParts.insertPhaseToken),
      isNotNull(contactImportParts.reconciliationContactIds),
      isNull(contactImportParts.completionToken),
    );
    const orm = this.database.orm;
    const completedPartState = and(
      eq(contactImportParts.jobId, input.jobId),
      eq(contactImportParts.part, input.part),
      eq(contactImportParts.totalParts, input.totalParts),
      eq(contactImportParts.status, "completed"),
      eq(contactImportParts.completionToken, completionToken),
    );
    const partUpdate = orm
      .update(contactImportParts)
      .set({
        status: "completed",
        reconciliationPublishedAt: reconciliationIsEmpty ? input.now : null,
        processed,
        succeeded,
        failed,
        completionToken,
        leaseId: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        updatedAt: input.now,
      })
      .where(phaseIsAuthorized);
    const jobUpdate = orm
      .update(importJobs)
      .set({
        status: finished ? "completed" : "processing",
        cursor: JSON.stringify({ part: input.part + 1, totalParts: input.totalParts }),
        processed: sql`${importJobs.processed} + ${processed}`,
        succeeded: sql`${importJobs.succeeded} + ${succeeded}`,
        failed: sql`${importJobs.failed} + ${failed}`,
        updatedAt: input.now,
      })
      .where(
        and(
          activeImportJob(input.jobId),
          exists(
            orm
              .select({ value: sql<number>`1` })
              .from(contactImportParts)
              .where(completedPartState),
          ),
        ),
      );
    const results = finished
      ? await orm.batch([partUpdate, jobUpdate])
      : await orm.batch([
          partUpdate,
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
                  insertPhaseToken: sql<string | null>`NULL`.as("insert_phase_token"),
                  reconciliationContactIds: sql<string | null>`NULL`.as(
                    "reconciliation_contact_ids",
                  ),
                  reconciliationPublishedAt: sql<string | null>`NULL`.as(
                    "reconciliation_published_at",
                  ),
                  completionToken: sql<string | null>`NULL`.as("completion_token"),
                  processed: sql<number>`0`.as("processed"),
                  succeeded: sql<number>`0`.as("succeeded"),
                  failed: sql<number>`0`.as("failed"),
                  lastError: sql<string | null>`NULL`.as("last_error"),
                  createdAt: sql<string>`${input.now}`.as("created_at"),
                  updatedAt: sql<string>`${input.now}`.as("updated_at"),
                  completedAt: sql<string | null>`NULL`.as("completed_at"),
                })
                .from(contactImportParts)
                .where(
                  and(
                    completedPartState,
                    exists(
                      orm
                        .select({ value: sql<number>`1` })
                        .from(importJobs)
                        .where(
                          and(
                            eq(importJobs.id, input.jobId),
                            eq(importJobs.kind, "contact_import"),
                            eq(importJobs.status, "processing"),
                            eq(importJobs.updatedAt, input.now),
                          ),
                        ),
                    ),
                  ),
                ),
            )
            .onConflictDoNothing(),
        ]);
    return changedExactlyOne(results[0] as D1Result);
  }

  private leaseAuthority(input: CompletionInput, authority: CompletionAuthority) {
    return authority === "live"
      ? liveImportPartLease(input.jobId, input.part, input.leaseId)
      : expiredImportPartLease(input.jobId, input.part, input.leaseId);
  }
}

interface CompletionInput {
  jobId: string;
  part: number;
  totalParts: number;
  leaseId: string;
  now: string;
}
