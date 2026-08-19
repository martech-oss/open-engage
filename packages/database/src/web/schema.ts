import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { PROJECT_RESOURCE_TYPES } from "@openengage/core/projects";
import {
  ASSET_CHECKSUM_ALGORITHMS,
  ASSET_KINDS,
  ASSET_VISIBILITIES,
} from "@openengage/core/shared";

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

export const assets = sqliteTable(
  "assets",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Editable display name. The R2 key is derived from `originalFilename`, not this. */
    name: text().notNull(),
    originalFilename: text("original_filename").notNull(),
    kind: text().default("other").notNull(),
    description: text().default("").notNull(),
    altText: text("alt_text").default("").notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    /**
     * Content fingerprint for cache-busting and duplicate detection, not an
     * integrity attestation - see `checksumAlgorithm`.
     */
    checksum: text().notNull(),
    checksumAlgorithm: text("checksum_algorithm").default("sha256").notNull(),
    /** Images only; measured client-side because Workers have no image decoder. */
    width: integer(),
    height: integer(),
    visibility: text().default("private").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assets_workspace_archived_created_idx").on(
      table.workspaceId,
      table.archivedAt,
      table.createdAt,
    ),
    uniqueIndex("assets_workspace_key_unique").on(table.workspaceId, table.r2Key),
    checkEnum("assets_kind_check", table.kind, ASSET_KINDS),
    checkEnum("assets_visibility_check", table.visibility, ASSET_VISIBILITIES),
    checkEnum(
      "assets_checksum_algorithm_check",
      table.checksumAlgorithm,
      ASSET_CHECKSUM_ALGORITHMS,
    ),
  ],
);

export const forms = sqliteTable(
  "forms",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: text().default("draft").notNull(),
    version: integer().default(1).notNull(),
    definition: text().notNull(),
    allowedDomains: text("allowed_domains").default("[]").notNull(),
    turnstileEnabled: integer("turnstile_enabled", { mode: "boolean" }).default(true).notNull(),
    successMessage: text("success_message").default("ありがとうございます。").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("forms_workspace_slug_unique").on(table.workspaceId, table.slug),
    check("forms_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().notNull(),
    ipHash: text("ip_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("form_submissions_workspace_form_created_idx").on(
      table.workspaceId,
      table.formId,
      table.createdAt,
    ),
    index("form_submissions_workspace_created_idx").on(table.workspaceId, table.createdAt),
    uniqueIndex("form_submissions_workspace_idempotency_unique").on(
      table.workspaceId,
      table.formId,
      table.idempotencyKey,
    ),
  ],
);

export const landingPages = sqliteTable(
  "landing_pages",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: text().default("draft").notNull(),
    // Unconstrained for the same reason as automations.draftVersionId: a real
    // FK would make landingPages<->landingPageVersions a two-table reference
    // cycle (each version also points back at its page).
    currentVersionId: text("current_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("landing_pages_workspace_slug_unique").on(table.workspaceId, table.slug),
    check("landing_pages_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const landingPageVersions = sqliteTable(
  "landing_page_versions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => landingPages.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    contentDocument: text("content_document").notNull(),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("landing_page_versions_workspace_page_version_unique").on(
      table.workspaceId,
      table.pageId,
      table.version,
    ),
  ],
);

export const siteTrackingSettings = sqliteTable(
  "site_tracking_settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: integer({ mode: "boolean" }).default(false).notNull(),
    allowedDomains: text("allowed_domains").default("[]").notNull(),
    consentMode: text("consent_mode").default("required").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("site_tracking_settings_consent_mode_check", sql`${table.consentMode} IN ('required')`),
  ],
);

export const siteMessages = sqliteTable(
  "site_messages",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    status: text().default("draft").notNull(),
    headline: text().notNull(),
    body: text().default("").notNull(),
    ctaLabel: text("cta_label").default("").notNull(),
    ctaUrl: text("cta_url"),
    pagePattern: text("page_pattern").default("*").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    impressionCount: integer("impression_count").default(0).notNull(),
    clickCount: integer("click_count").default(0).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("site_messages_workspace_schedule_idx").on(
      table.workspaceId,
      table.startsAt,
      table.endsAt,
    ),
    index("site_messages_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    check("site_messages_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

/**
 * A named, shareable link whose clicks are attributed. Unlike the per-delivery
 * click redirect in email, the URL here is stable and public, so it can be
 * pasted into a landing page, an ad, or a social post and still report back.
 */
export const customRedirects = sqliteTable(
  "custom_redirects",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    destinationUrl: text("destination_url").notNull(),
    clickCount: integer("click_count").default(0).notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custom_redirects_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    uniqueIndex("custom_redirects_workspace_slug_unique").on(table.workspaceId, table.slug),
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
