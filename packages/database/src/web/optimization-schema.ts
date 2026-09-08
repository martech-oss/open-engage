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
import { siteVisitors } from "../contacts/visitor-schema";
import { landingPages, landingPageVersions } from "./schema";

export const landingExperiments = sqliteTable(
  "landing_experiments",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => landingPages.id, { onDelete: "cascade" }),
    name: text().notNull(),
    status: text().notNull().default("draft"),
    variants: text().notNull(),
    winnerVariantId: text("winner_variant_id"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("landing_experiments_workspace_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("landing_experiments_one_running")
      .on(table.workspaceId, table.pageId)
      .where(sql`${table.status} = 'running'`),
    index("landing_experiments_workspace_page_idx").on(table.workspaceId, table.pageId),
    check("landing_experiments_status_check", sql`${table.status} IN ('draft','running','ended')`),
  ],
);
export const experimentExposures = sqliteTable(
  "experiment_exposures",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id").notNull(),
    experimentId: text("experiment_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    variantId: text("variant_id").notNull(),
    pageVersionId: text("page_version_id")
      .notNull()
      .references(() => landingPageVersions.id, { onDelete: "cascade" }),
    exposedAt: text("exposed_at"),
    convertedAt: text("converted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.experimentId],
      foreignColumns: [landingExperiments.workspaceId, landingExperiments.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.visitorId],
      foreignColumns: [siteVisitors.workspaceId, siteVisitors.id],
    }).onDelete("cascade"),
    uniqueIndex("experiment_exposures_visitor_unique").on(
      table.workspaceId,
      table.experimentId,
      table.visitorId,
    ),
    index("experiment_exposures_cohort_idx").on(
      table.workspaceId,
      table.experimentId,
      table.exposedAt,
    ),
  ],
);
export const dynamicContents = sqliteTable(
  "dynamic_contents",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => landingPages.id, { onDelete: "cascade" }),
    slotId: text("slot_id").notNull(),
    fallbackHtml: text("fallback_html").notNull(),
    rules: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.pageId, table.slotId] })],
);
