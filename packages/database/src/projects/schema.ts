import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { PROJECT_RESOURCE_TYPES } from "@openengage/core/projects";

import { organization, user } from "../auth/schema";
import { contactEvents, contacts } from "../contacts/schema";
import { checkEnum } from "../shared/enum-check";

export const projects = sqliteTable(
  "projects",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().default("").notNull(),
    color: text().default("#7c3aed").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("projects_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    uniqueIndex("projects_workspace_id_unique").on(table.workspaceId, table.id),
  ],
);

export const projectBriefs = sqliteTable(
  "project_briefs",
  {
    projectId: text("project_id")
      .primaryKey()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text().default("draft").notNull(),
    revision: integer().default(1).notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    approverUserId: text("approver_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    primaryMotion: text("primary_motion").notNull(),
    reviewAt: text("review_at").notNull(),
    definition: text().notNull(),
    submittedAt: text("submitted_at"),
    approvedAt: text("approved_at"),
    approvedByUserId: text("approved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_briefs_workspace_status_review_idx").on(
      table.workspaceId,
      table.status,
      table.reviewAt,
    ),
    index("project_briefs_workspace_owner_idx").on(table.workspaceId, table.ownerUserId),
    uniqueIndex("project_briefs_workspace_project_unique").on(table.workspaceId, table.projectId),
    check(
      "project_briefs_status_check",
      sql`${table.status} IN ('draft', 'pending_approval', 'approved', 'completed')`,
    ),
    check(
      "project_briefs_motion_check",
      sql`${table.primaryMotion} IN ('acquisition', 'onboarding', 'engagement', 'retention', 'reactivation', 'measurement')`,
    ),
    check("project_briefs_revision_check", sql`${table.revision} >= 1`),
    check("project_briefs_row_version_check", sql`${table.rowVersion} >= 1`),
    check("project_briefs_definition_json_check", sql`json_valid(${table.definition})`),
    check(
      "project_briefs_distinct_reviewers_check",
      sql`${table.ownerUserId} != ${table.approverUserId}`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "project_briefs_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

export const projectBriefVersions = sqliteTable(
  "project_brief_versions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    revision: integer().notNull(),
    name: text().notNull(),
    description: text().default("").notNull(),
    color: text().notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    approverUserId: text("approver_user_id").notNull(),
    primaryMotion: text("primary_motion").notNull(),
    reviewAt: text("review_at").notNull(),
    definition: text().notNull(),
    approvedByUserId: text("approved_by_user_id").notNull(),
    approvedAt: text("approved_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.revision],
      name: "project_brief_versions_workspace_project_revision_pk",
    }),
    index("project_brief_versions_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
      table.revision,
    ),
    check("project_brief_versions_revision_check", sql`${table.revision} >= 1`),
    check("project_brief_versions_definition_json_check", sql`json_valid(${table.definition})`),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "project_brief_versions_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

export const projectBriefReviews = sqliteTable(
  "project_brief_reviews",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: text().notNull(),
    comment: text().default("").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_brief_reviews_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
    check(
      "project_brief_reviews_decision_check",
      sql`${table.decision} IN ('approved', 'rejected')`,
    ),
    check("project_brief_reviews_revision_check", sql`${table.revision} >= 1`),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectBriefs.workspaceId, projectBriefs.projectId],
      name: "project_brief_reviews_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

export const projectItems = sqliteTable(
  "project_items",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    briefRevision: integer("brief_revision"),
    addedByUserId: text("added_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.resourceType, table.resourceId],
      name: "project_items_workspace_id_project_id_resource_type_resource_id_pk",
    }),
    checkEnum("project_items_resource_type_check", table.resourceType, PROJECT_RESOURCE_TYPES),
    check(
      "project_items_brief_revision_check",
      sql`${table.briefRevision} IS NULL OR ${table.briefRevision} >= 1`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "project_items_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * One recorded interaction between a contact and a resource that belongs to a
 * project. Projects already group automations, emails, forms, pages and
 * segments, so they act as the campaign: this table is what turns that grouping
 * into attribution without a second campaign concept.
 */
export const campaignTouches = sqliteTable(
  "campaign_touches",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    eventType: text("event_type").notNull(),
    sourceEventId: text("source_event_id").references(() => contactEvents.id, {
      onDelete: "cascade",
    }),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("campaign_touches_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.occurredAt,
    ),
    index("campaign_touches_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
      table.occurredAt,
    ),
    uniqueIndex("campaign_touches_source_event_project_unique").on(
      table.workspaceId,
      table.sourceEventId,
      table.projectId,
    ),
  ],
);

export const campaignCosts = sqliteTable(
  "campaign_costs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    bookedOn: text("booked_on").notNull(),
    category: text().notNull(),
    amount: real().notNull(),
    currency: text().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    index("campaign_costs_workspace_date_currency_idx").on(
      table.workspaceId,
      table.bookedOn,
      table.currency,
    ),
    check("campaign_costs_amount_check", sql`${table.amount} >= 0`),
  ],
);
