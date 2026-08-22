import { and, asc, eq, gt, or, sql } from "drizzle-orm";

import type { ContactExportFilter } from "@openengage/core/contacts";
import { jsonRecordSchema } from "@openengage/core/shared";

import type { OpenEngageDatabase } from "../client";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { decodeJson } from "../shared/json-codec";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { buildContactFilterPredicate } from "./filter-predicate";
import { contactImportParts, contacts, importJobs } from "./schema";

export type DataJobKind = "contact_import" | "contact_export";

/** One line of an import part, already normalized by the worker. */
export interface ContactImportRow {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  externalId: string | null;
  stage: string;
  customFields: Record<string, unknown>;
}

/** Workspace-facing queries for import/export jobs. */
export class DataJobRepository extends WorkspaceRepository {
  public async createJob(input: {
    id: string;
    kind: DataJobKind;
    r2Key: string;
    cursor: Record<string, unknown>;
  }): Promise<void> {
    const now = nowIso();
    const totalParts =
      input.kind === "contact_import" && typeof input.cursor["totalParts"] === "number"
        ? input.cursor["totalParts"]
        : null;
    const jobInsert = this.database.orm.insert(importJobs).values({
      id: input.id,
      workspaceId: this.context.workspaceId,
      kind: input.kind,
      r2Key: input.r2Key,
      status: totalParts === 0 ? "completed" : "pending",
      cursor: JSON.stringify(totalParts === null ? input.cursor : { part: 0, totalParts }),
      createdAt: now,
      updatedAt: now,
    });
    if (totalParts !== null && totalParts > 0) {
      await this.database.orm.batch([
        jobInsert,
        this.database.orm.insert(contactImportParts).values({
          jobId: input.id,
          part: 0,
          totalParts,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      return;
    }
    await jobInsert;
  }

  public markCompleted(jobId: string): Promise<void> {
    return completeJob(this.database, jobId);
  }

  public async getDataJob(jobId: string) {
    const row = await this.database.orm
      .select({
        id: importJobs.id,
        kind: importJobs.kind,
        status: importJobs.status,
        processed: importJobs.processed,
        succeeded: importJobs.succeeded,
        failed: importJobs.failed,
        cursor: importJobs.cursor,
        errorManifestKey: importJobs.errorManifestKey,
        createdAt: importJobs.createdAt,
        updatedAt: importJobs.updatedAt,
      })
      .from(importJobs)
      .where(and(this.inWorkspace(importJobs), eq(importJobs.id, jobId)))
      .get();
    if (!row) return null;
    const { cursor: encodedCursor, ...job } = row;
    const cursor = safeJsonRecord(encodedCursor);
    return {
      ...job,
      attempts: nonnegativeInteger(cursor["attempts"]),
      error:
        row.status === "failed" && typeof cursor["error"] === "string" ? cursor["error"] : null,
    };
  }

  public async getExportJob(jobId: string): Promise<{ r2Key: string; status: string } | null> {
    const row = await this.database.orm
      .select({ r2Key: importJobs.r2Key, status: importJobs.status })
      .from(importJobs)
      .where(
        and(
          this.inWorkspace(importJobs),
          eq(importJobs.id, jobId),
          eq(importJobs.kind, "contact_export"),
        ),
      )
      .get();
    return row ?? null;
  }
}

/**
 * Queue-worker queries for import/export processing. Jobs are claimed by id
 * alone — the workspace comes from the job row itself — so this repository is
 * intentionally not workspace-scoped.
 */
export class DataJobWorkerRepository extends DatabaseRepository {
  public async claimExportJob(input: {
    jobId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{
    workspaceId: string;
    r2Key: string;
    cursor: Record<string, unknown>;
    leaseId: string;
    attempts: number;
  } | null> {
    const leaseId = uuidv7();
    const [row] = await this.database.orm
      .update(importJobs)
      .set({
        status: "processing",
        cursor: sql`json_set(
          COALESCE(${importJobs.cursor}, '{}'),
          '$.leaseId', ${leaseId},
          '$.leaseExpiresAt', ${input.leaseExpiresAt},
          '$.attempts', COALESCE(CAST(json_extract(${importJobs.cursor}, '$.attempts') AS INTEGER), 0) + 1
        )`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(importJobs.id, input.jobId),
          eq(importJobs.kind, "contact_export"),
          or(
            eq(importJobs.status, "pending"),
            and(
              eq(importJobs.status, "processing"),
              or(
                sql`json_extract(${importJobs.cursor}, '$.leaseId') IS NULL`,
                sql`json_extract(${importJobs.cursor}, '$.leaseExpiresAt') <= ${input.now}`,
              ),
            ),
          ),
        ),
      )
      .returning({
        workspaceId: importJobs.workspaceId,
        r2Key: importJobs.r2Key,
        cursor: importJobs.cursor,
      });
    if (!row) return null;
    const cursor = safeJsonRecord(row.cursor);
    return {
      ...row,
      cursor,
      leaseId,
      attempts: nonnegativeInteger(cursor["attempts"]),
    };
  }

  /**
   * Pages contacts by id for export. Returns `customFields` as the raw stored
   * JSON text so the CSV reproduces the column byte for byte.
   */
  public listContactsForExport(
    workspaceId: string,
    filter: ContactExportFilter,
    afterId: string,
    limit: number,
  ) {
    return this.database.orm
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        externalId: contacts.externalId,
        stage: contacts.stage,
        score: contacts.score,
        status: contacts.status,
        customFields: contacts.customFields,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(
        and(
          buildContactFilterPredicate(this.database, workspaceId, filter),
          gt(contacts.id, afterId),
        ),
      )
      .orderBy(asc(contacts.id))
      .limit(limit);
  }

  /** Advances the export cursor; every paged row counts as succeeded. */
  public async recordExportProgress(input: {
    jobId: string;
    leaseId: string;
    cursor: Record<string, unknown>;
    count: number;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .update(importJobs)
      .set({
        status: "processing",
        cursor: JSON.stringify({ ...input.cursor, attempts: 0 }),
        processed: sql`${importJobs.processed} + ${input.count}`,
        succeeded: sql`${importJobs.succeeded} + ${input.count}`,
        updatedAt: input.now,
      })
      .where(liveExportLease(input.jobId, input.leaseId, input.now));
    return changedExactlyOne(result);
  }

  public async completeExportForLease(input: {
    jobId: string;
    leaseId: string;
    cursor: Record<string, unknown>;
    count: number;
    attempts: number;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .update(importJobs)
      .set({
        status: "completed",
        cursor: JSON.stringify({ ...input.cursor, attempts: input.attempts }),
        processed: sql`${importJobs.processed} + ${input.count}`,
        succeeded: sql`${importJobs.succeeded} + ${input.count}`,
        updatedAt: input.now,
      })
      .where(liveExportLease(input.jobId, input.leaseId, input.now));
    return changedExactlyOne(result);
  }

  public async returnExportToPending(input: {
    jobId: string;
    leaseId: string;
    error: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .update(importJobs)
      .set({
        status: "pending",
        cursor: sql`json_set(
          json_remove(COALESCE(${importJobs.cursor}, '{}'), '$.leaseId', '$.leaseExpiresAt'),
          '$.error', ${input.error}
        )`,
        updatedAt: input.now,
      })
      .where(liveExportLease(input.jobId, input.leaseId, input.now));
    return changedExactlyOne(result);
  }

  public async failExportForLease(input: {
    jobId: string;
    leaseId: string;
    error: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.database.orm
      .update(importJobs)
      .set({
        status: "failed",
        cursor: sql`json_set(
          json_remove(COALESCE(${importJobs.cursor}, '{}'), '$.leaseId', '$.leaseExpiresAt'),
          '$.error', ${input.error}
        )`,
        updatedAt: input.now,
      })
      .where(liveExportLease(input.jobId, input.leaseId, input.now));
    return changedExactlyOne(result);
  }
}

function liveExportLease(jobId: string, leaseId: string, now: string) {
  return and(
    eq(importJobs.id, jobId),
    eq(importJobs.kind, "contact_export"),
    eq(importJobs.status, "processing"),
    sql`json_extract(${importJobs.cursor}, '$.leaseId') = ${leaseId}`,
    sql`json_extract(${importJobs.cursor}, '$.leaseExpiresAt') > ${now}`,
  );
}

async function completeJob(database: OpenEngageDatabase, jobId: string): Promise<void> {
  await database.orm
    .update(importJobs)
    .set({ status: "completed", updatedAt: nowIso() })
    .where(eq(importJobs.id, jobId));
}

/** Parses an object-shaped JSON column, treating malformed values as empty. */
function safeJsonRecord(value: string | null): Record<string, unknown> {
  return value === null ? {} : decodeJson(value, jsonRecordSchema, "import_jobs.cursor");
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
