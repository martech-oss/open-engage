import {
  foreignKey,
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
import { automationEnrollments } from "../automations/schema";
import { contactEvents, contacts, tags } from "../contacts/schema";
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
    uniqueIndex("scoring_categories_workspace_id_unique").on(table.workspaceId, table.id),
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
    decayDays: integer("decay_days"),
    maxScore: integer("max_score"),
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
    foreignKey({
      columns: [table.workspaceId, table.categoryId],
      foreignColumns: [scoringCategories.workspaceId, scoringCategories.id],
      name: "scoring_rules_workspace_category_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.tagId],
      foreignColumns: [tags.workspaceId, tags.id],
      name: "scoring_rules_workspace_tag_fk",
    }),
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
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "contact_category_scores_workspace_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.categoryId],
      foreignColumns: [scoringCategories.workspaceId, scoringCategories.id],
      name: "contact_category_scores_workspace_category_fk",
    }).onDelete("cascade"),
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

/** Score mutations and their automation/contact-event provenance. */
export const scoreEvents = sqliteTable(
  "score_events",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    delta: integer().notNull(),
    reason: text().notNull(),
    automationEnrollmentId: text("automation_enrollment_id").references(
      () => automationEnrollments.id,
      { onDelete: "set null" },
    ),
    contactEventId: text("contact_event_id").references(() => contactEvents.id, {
      onDelete: "cascade",
    }),
    scoringRuleId: text("scoring_rule_id").references(() => scoringRules.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("score_events_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.createdAt,
    ),
    uniqueIndex("score_events_contact_event_rule_unique").on(
      table.workspaceId,
      table.contactEventId,
      table.scoringRuleId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "score_events_workspace_contact_fk",
    }).onDelete("cascade"),
  ],
);

/** New positive contributions only; independent of event retention and rule archival. */
export const scoreContributions = sqliteTable(
  "score_contributions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull(),
    ruleId: text("rule_id").notNull(),
    categoryId: text("category_id"),
    initialScore: integer("initial_score").notNull(),
    remainingScore: integer("remaining_score").notNull(),
    decayDays: integer("decay_days"),
    occurredAt: text("occurred_at").notNull(),
    nextDecayAt: text("next_decay_at"),
  },
  (table) => [
    index("score_contributions_contact_rule_idx").on(
      table.workspaceId,
      table.contactId,
      table.ruleId,
    ),
    index("score_contributions_due_idx").on(table.nextDecayAt),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("cascade"),
  ],
);
