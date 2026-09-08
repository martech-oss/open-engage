import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { projects } from "./schema";
export const projectVariables = sqliteTable(
  "project_variables",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    key: text().notNull(),
    type: text().notNull(),
    value: text().notNull(),
    revision: integer().notNull().default(1),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("project_variables_workspace_key_unique")
      .on(table.workspaceId, table.key)
      .where(sql`${table.projectId} IS NULL`),
    uniqueIndex("project_variables_project_key_unique").on(
      table.workspaceId,
      table.projectId,
      table.key,
    ),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    check(
      "project_variables_type_check",
      sql`${table.type} IN ('string','number','boolean','datetime','url')`,
    ),
    check("project_variables_revision_check", sql`${table.revision}>0`),
  ],
);
