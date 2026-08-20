import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { decodeReconciliationContactIds } from "./import-part-state";
import { contactImportParts, importJobs } from "./schema";

const IMPORT_RECONCILIATION_SCAN_LIMIT = 100;

export interface ContactImportReconciliation {
  jobId: string;
  part: number;
  workspaceId: string;
  contactIds: string[];
}

/** Publishes only reconciliation evidence committed by a completed import part. */
export class ContactImportReconciliationRepository extends DatabaseRepository {
  public async readPending(
    jobId: string,
    part: number,
  ): Promise<ContactImportReconciliation | null> {
    const row = await this.database.orm
      .select({
        jobId: contactImportParts.jobId,
        part: contactImportParts.part,
        workspaceId: importJobs.workspaceId,
        contactIds: contactImportParts.reconciliationContactIds,
      })
      .from(contactImportParts)
      .innerJoin(importJobs, eq(importJobs.id, contactImportParts.jobId))
      .where(
        and(
          eq(contactImportParts.jobId, jobId),
          eq(contactImportParts.part, part),
          pendingReconciliation(),
        ),
      )
      .get();
    return row?.contactIds
      ? { ...row, contactIds: decodeReconciliationContactIds(row.contactIds) }
      : null;
  }

  public async scanPending(): Promise<ContactImportReconciliation[]> {
    const rows = await this.database.orm
      .select({
        jobId: contactImportParts.jobId,
        part: contactImportParts.part,
        workspaceId: importJobs.workspaceId,
        contactIds: contactImportParts.reconciliationContactIds,
      })
      .from(contactImportParts)
      .innerJoin(importJobs, eq(importJobs.id, contactImportParts.jobId))
      .where(pendingReconciliation())
      .orderBy(asc(contactImportParts.updatedAt), asc(contactImportParts.jobId))
      .limit(IMPORT_RECONCILIATION_SCAN_LIMIT);
    return rows.flatMap((row) =>
      row.contactIds
        ? [{ ...row, contactIds: decodeReconciliationContactIds(row.contactIds) }]
        : [],
    );
  }

  public async markPublished(jobId: string, part: number, now: string): Promise<boolean> {
    const result = await this.database.orm
      .update(contactImportParts)
      .set({ reconciliationPublishedAt: now, updatedAt: now })
      .where(
        and(
          eq(contactImportParts.jobId, jobId),
          eq(contactImportParts.part, part),
          pendingReconciliation(),
        ),
      );
    return changedExactlyOne(result);
  }
}

function pendingReconciliation() {
  return and(
    eq(contactImportParts.status, "completed"),
    isNotNull(contactImportParts.reconciliationContactIds),
    isNull(contactImportParts.reconciliationPublishedAt),
  );
}
