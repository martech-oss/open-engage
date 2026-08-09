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

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";

export const segments = sqliteTable(
  "segments",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().default("").notNull(),
    kind: text().notNull(),
    filterAst: text("filter_ast"),
    membershipSource: text("membership_source"),
    filterVersion: integer("filter_version").default(1).notNull(),
    memberCount: integer("member_count").default(0).notNull(),
    evaluatedAt: text("evaluated_at"),
    evaluationStatus: text("evaluation_status").default("ready").notNull(),
    evaluationError: text("evaluation_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("segments_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    uniqueIndex("segments_workspace_slug_unique").on(table.workspaceId, table.slug),
    check("segments_kind_check", sql`${table.kind} IN ('static', 'dynamic')`),
    check(
      "segments_evaluation_status_check",
      sql`${table.evaluationStatus} IN ('pending', 'running', 'ready', 'failed')`,
    ),
  ],
);

export const segmentMemberships = sqliteTable(
  "segment_memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    segmentId: text("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    source: text().notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [
    index("segment_memberships_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.segmentId,
    ),
    primaryKey({
      columns: [table.workspaceId, table.segmentId, table.contactId],
      name: "segment_memberships_workspace_id_segment_id_contact_id_pk",
    }),
    check(
      "segment_memberships_source_check",
      sql`${table.source} IN ('static', 'dynamic', 'automation')`,
    ),
  ],
);
