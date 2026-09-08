import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { contacts } from "./schema";

/** Actual first arrivals only. Lead arrival is contacts.createdAt. */
export const contactLifecycleHistory = sqliteTable(
  "contact_lifecycle_history",
  {
    workspaceId: text("workspace_id").notNull(),
    contactId: text("contact_id").notNull(),
    stage: text().notNull(),
    reachedAt: text("reached_at").notNull(),
    source: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.contactId, table.stage] }),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("cascade"),
    index("contact_lifecycle_stage_time_idx").on(table.workspaceId, table.stage, table.reachedAt),
    check("contact_lifecycle_stage_check", sql`${table.stage} IN ('mql','sql','customer')`),
  ],
);
