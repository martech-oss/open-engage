import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { jsonRecordSchema } from "@openengage/core/shared";

import type { OpenEngageDatabase } from "../client";
import { nowIso } from "../shared/database-utils";
import { decodeJson } from "../shared/json-codec";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
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
        errorManifestKey: importJobs.errorManifestKey,
        createdAt: importJobs.createdAt,
        updatedAt: importJobs.updatedAt,
      })
      .from(importJobs)
      .where(and(this.inWorkspace(importJobs), eq(importJobs.id, jobId)))
      .get();
    return row ?? null;
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
  public async claimExportJob(jobId: string): Promise<{
    workspaceId: string;
    r2Key: string;
    status: string;
    cursor: Record<string, unknown>;
  } | null> {
    const row = await this.database.orm
      .select({
        workspaceId: importJobs.workspaceId,
        r2Key: importJobs.r2Key,
        status: importJobs.status,
        cursor: importJobs.cursor,
      })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.id, jobId),
          eq(importJobs.kind, "contact_export"),
          inArray(importJobs.status, ["pending", "processing"]),
        ),
      )
      .get();
    if (!row) return null;
    return { ...row, cursor: safeJsonRecord(row.cursor) };
  }

  /**
   * Pages contacts by id for export. Returns `customFields` as the raw stored
   * JSON text so the CSV reproduces the column byte for byte.
   */
  public listContactsForExport(workspaceId: string, afterId: string, limit: number) {
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
      .where(and(eq(contacts.workspaceId, workspaceId), gt(contacts.id, afterId)))
      .orderBy(asc(contacts.id))
      .limit(limit);
  }

  /** Advances the export cursor; every paged row counts as succeeded. */
  public async recordExportProgress(
    jobId: string,
    input: { cursor: Record<string, unknown>; count: number },
  ): Promise<void> {
    await this.database.orm
      .update(importJobs)
      .set({
        status: "processing",
        cursor: JSON.stringify(input.cursor),
        processed: sql`${importJobs.processed} + ${input.count}`,
        succeeded: sql`${importJobs.succeeded} + ${input.count}`,
        updatedAt: nowIso(),
      })
      .where(eq(importJobs.id, jobId));
  }

  public markCompleted(jobId: string): Promise<void> {
    return completeJob(this.database, jobId);
  }
}

async function completeJob(database: OpenEngageDatabase, jobId: string): Promise<void> {
  await database.orm
    .update(importJobs)
    .set({ status: "completed", updatedAt: nowIso() })
    .where(eq(importJobs.id, jobId));
}

/** Parses an object-shaped JSON column, treating malformed values as empty. */
function safeJsonRecord(value: string | null): Record<string, unknown> {
  return value === null ? {} : decodeJson(value, jsonRecordSchema, "contacts.custom_fields");
}
