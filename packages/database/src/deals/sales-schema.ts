import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";
import { contacts } from "../contacts/schema";
export const assignmentGroups = sqliteTable(
  "assignment_groups",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    mode: text().notNull(),
    userIds: text("user_ids").notNull(),
    cursor: integer().notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("assignment_groups_workspace_idx").on(table.workspaceId)],
);
export const salesHandoffs = sqliteTable(
  "sales_handoffs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    executionKey: text("execution_key").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    taskId: text("task_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sales_handoffs_execution_unique").on(table.workspaceId, table.executionKey),
  ],
);
export const appNotifications = sqliteTable(
  "app_notifications",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    title: text().notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("app_notifications_user_idx").on(table.workspaceId, table.userId, table.createdAt),
  ],
);
