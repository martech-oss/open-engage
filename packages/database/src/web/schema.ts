import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";

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
