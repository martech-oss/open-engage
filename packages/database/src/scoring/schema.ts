import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  GRADING_OPERATORS,
  SCORING_EVENT_TYPES,
  SCORING_MATCH_TYPES,
} from "@openengage/core/scoring";

import { organization } from "../auth/schema";
import { contacts, tags } from "../contacts/schema";
import { checkEnum } from "../shared/enum-check";

/**
 * A scoring category splits one behavioural score into per-interest scores -
 * Pardot's "product A vs product B" axis. Rules without a category only move
 * the overall `contacts.score`.
 */
export const scoringCategories = sqliteTable(
  "scoring_categories",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("scoring_categories_workspace_slug_unique").on(table.workspaceId, table.slug),
  ],
);

/**
 * One behaviour-to-points rule. A `page_viewed` rule with a URL match is
 * exactly Pardot's Page Action, so both features share this table instead of
 * growing two near-identical evaluation paths.
 */
export const scoringRules = sqliteTable(
  "scoring_rules",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    eventType: text("event_type").notNull(),
    matchType: text("match_type").default("any").notNull(),
    matchValue: text("match_value"),
    points: integer().default(0).notNull(),
    categoryId: text("category_id").references(() => scoringCategories.id, {
      onDelete: "set null",
    }),
    tagId: text("tag_id").references(() => tags.id, { onDelete: "set null" }),
    enabled: integer({ mode: "boolean" }).default(true).notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("scoring_rules_workspace_event_idx").on(
      table.workspaceId,
      table.eventType,
      table.enabled,
    ),
    checkEnum("scoring_rules_event_type_check", table.eventType, SCORING_EVENT_TYPES),
    checkEnum("scoring_rules_match_type_check", table.matchType, SCORING_MATCH_TYPES),
  ],
);

export const contactCategoryScores = sqliteTable(
  "contact_category_scores",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => scoringCategories.id, { onDelete: "cascade" }),
    score: integer().default(0).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("contact_category_scores_workspace_category_idx").on(
      table.workspaceId,
      table.categoryId,
      table.score,
    ),
    primaryKey({
      columns: [table.workspaceId, table.contactId, table.categoryId],
      name: "contact_category_scores_workspace_id_contact_id_category_id_pk",
    }),
  ],
);

/**
 * Profile-fit criteria behind the A-F grade. Each match nudges the grade by
 * `steps` thirds of a letter from the D baseline, mirroring how Pardot grades.
 */
export const gradingCriteria = sqliteTable(
  "grading_criteria",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    field: text().notNull(),
    fieldKey: text("field_key"),
    operator: text().notNull(),
    value: text().notNull(),
    steps: integer().default(1).notNull(),
    enabled: integer({ mode: "boolean" }).default(true).notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("grading_criteria_workspace_idx").on(table.workspaceId, table.enabled),
    checkEnum("grading_criteria_operator_check", table.operator, GRADING_OPERATORS),
  ],
);
