import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { projects } from "./schema";
export const programMemberImports = sqliteTable(
  "program_member_imports",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    requestKey: text("request_key").notNull(),
    fingerprint: text().notNull(),
    csv: text().notNull(),
    actorUserId: text("actor_user_id").notNull(),
    status: text().notNull(),
    total: integer().notNull(),
    processed: integer().notNull().default(0),
    leaseId: text("lease_id"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("program_member_import_request").on(t.workspaceId, t.projectId, t.requestKey),
    index("program_member_import_recovery").on(t.status, t.leaseUntil, t.updatedAt),
    foreignKey({
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
  ],
);
export const programMemberImportRows = sqliteTable(
  "program_member_import_rows",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => programMemberImports.id, { onDelete: "cascade" }),
    row: integer().notNull(),
    result: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.row] })],
);
