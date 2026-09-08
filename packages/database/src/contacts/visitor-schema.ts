import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { contacts } from "./schema";

export const siteVisitors = sqliteTable(
  "site_visitors",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("site_visitors_workspace_id_unique").on(table.workspaceId, table.id)],
);

/** An immutable browser-to-contact association; a shared browser rotates its visitor id. */
export const visitorBindings = sqliteTable(
  "visitor_bindings",
  {
    workspaceId: text("workspace_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    contactId: text("contact_id").notNull(),
    linkedAt: text("linked_at").notNull(),
    historyStatus: text("history_status").notNull().default("pending"),
    leaseId: text("lease_id"),
    leaseExpiresAt: text("lease_expires_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.visitorId] }),
    foreignKey({
      columns: [table.workspaceId, table.visitorId],
      foreignColumns: [siteVisitors.workspaceId, siteVisitors.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("cascade"),
    index("visitor_bindings_contact_idx").on(table.workspaceId, table.contactId),
    index("visitor_bindings_history_idx").on(table.historyStatus, table.leaseExpiresAt),
    check("visitor_bindings_history_check", sql`${table.historyStatus} IN ('pending','done')`),
  ],
);
