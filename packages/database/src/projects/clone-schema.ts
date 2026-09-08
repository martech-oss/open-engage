import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";

/** Staging lives only here: a partial clone is never a usable resource. */
export const projectCloneJobs = sqliteTable(
  "project_clone_jobs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceProjectId: text("source_project_id").notNull(),
    targetProjectId: text("target_project_id").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    requestKey: text("request_key"),
    options: text().notNull(),
    sharedReferences: text("shared_references").notNull().default("[]"),
    referenceMap: text("reference_map").notNull(),
    status: text().notNull().default("preview"),
    error: text(),
    leaseId: text("lease_id"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("project_clone_jobs_request_unique").on(table.workspaceId, table.requestKey),
    uniqueIndex("project_clone_jobs_target_unique").on(table.targetProjectId),
    index("project_clone_jobs_recovery_idx").on(table.status, table.leaseUntil, table.updatedAt),
    index("project_clone_jobs_workspace_project_idx").on(
      table.workspaceId,
      table.sourceProjectId,
      table.createdAt,
    ),
    check(
      "project_clone_jobs_status_check",
      sql`${table.status} IN ('preview','queued','running','completed','failed')`,
    ),
    check(
      "project_clone_jobs_json_check",
      sql`json_valid(${table.options}) AND json_valid(${table.sharedReferences}) AND json_valid(${table.referenceMap})`,
    ),
  ],
);

export const projectCloneMappings = sqliteTable(
  "project_clone_mappings",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => projectCloneJobs.id, { onDelete: "cascade" }),
    ordinal: integer().notNull(),
    kind: text().notNull(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id").notNull(),
    metadata: text().notNull(),
    sourceRow: text("source_row").notNull(),
    targetRow: text("target_row"),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.kind, table.sourceId] }),
    uniqueIndex("project_clone_mappings_order_unique").on(table.jobId, table.ordinal),
    check(
      "project_clone_mappings_json_check",
      sql`json_valid(${table.metadata}) AND json_valid(${table.sourceRow}) AND (${table.targetRow} IS NULL OR json_valid(${table.targetRow}))`,
    ),
  ],
);
