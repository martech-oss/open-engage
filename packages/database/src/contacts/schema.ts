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

export const companies = sqliteTable(
  "companies",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    domain: text(),
    customFields: text("custom_fields").default("{}").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("companies_workspace_name_idx").on(table.workspaceId, table.name),
    uniqueIndex("companies_workspace_domain_unique")
      .on(table.workspaceId, table.domain)
      .where(sql`${table.domain} IS NOT NULL`),
  ],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id"),
    email: text(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text(),
    externalId: text("external_id"),
    stage: text().default("lead").notNull(),
    score: integer().default(0).notNull(),
    /** Thirds of a letter away from the D baseline; see core's gradeLetter(). */
    gradePoints: integer("grade_points").default(0).notNull(),
    status: text().default("active").notNull(),
    customFields: text("custom_fields").default("{}").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("contacts_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("contacts_workspace_stage_idx").on(table.workspaceId, table.stage),
    index("contacts_workspace_score_idx").on(table.workspaceId, table.score),
    index("contacts_workspace_created_idx").on(table.workspaceId, table.createdAt, table.id),
    uniqueIndex("contacts_workspace_visitor_unique")
      .on(table.workspaceId, table.visitorId)
      .where(sql`${table.visitorId} IS NOT NULL`),
    uniqueIndex("contacts_workspace_external_unique")
      .on(table.workspaceId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
    uniqueIndex("contacts_workspace_email_unique")
      .on(table.workspaceId, table.email)
      .where(sql`${table.email} IS NOT NULL`),
    check("contacts_status_check", sql`${table.status} IN ('active', 'archived', 'anonymous')`),
  ],
);

export const companyContacts = sqliteTable(
  "company_contacts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    title: text(),
    isPrimary: integer("is_primary", { mode: "boolean" }).default(false).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("company_contacts_workspace_contact_idx").on(table.workspaceId, table.contactId),
    primaryKey({
      columns: [table.workspaceId, table.companyId, table.contactId],
      name: "company_contacts_workspace_id_company_id_contact_id_pk",
    }),
  ],
);

export const customFieldDefinitions = sqliteTable(
  "custom_field_definitions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    key: text().notNull(),
    label: text().notNull(),
    dataType: text("data_type").notNull(),
    settings: text().default("{}").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_workspace_entity_key_unique").on(
      table.workspaceId,
      table.entityType,
      table.key,
    ),
    check(
      "custom_field_definitions_entity_type_check",
      sql`${table.entityType} IN ('contact', 'company')`,
    ),
    check(
      "custom_field_definitions_data_type_check",
      sql`${table.dataType} IN ('text', 'number', 'boolean', 'date', 'select')`,
    ),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    color: text().default("#64748b").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("tags_workspace_slug_unique").on(table.workspaceId, table.slug)],
);

export const contactTags = sqliteTable(
  "contact_tags",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("contact_tags_workspace_tag_idx").on(table.workspaceId, table.tagId, table.contactId),
    primaryKey({
      columns: [table.workspaceId, table.contactId, table.tagId],
      name: "contact_tags_workspace_id_contact_id_tag_id_pk",
    }),
  ],
);

export const contactEvents = sqliteTable(
  "contact_events",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    visitorId: text("visitor_id"),
    type: text().notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    properties: text().default("{}").notNull(),
    occurredAt: text("occurred_at").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("contact_events_workspace_visitor_idx").on(
      table.workspaceId,
      table.visitorId,
      table.occurredAt,
    ),
    index("contact_events_workspace_type_occurred_idx").on(
      table.workspaceId,
      table.type,
      table.occurredAt,
    ),
    index("contact_events_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.occurredAt,
    ),
  ],
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    r2Key: text("r2_key").notNull(),
    status: text().default("pending").notNull(),
    cursor: text(),
    processed: integer().default(0).notNull(),
    succeeded: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
    errorManifestKey: text("error_manifest_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("import_jobs_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    check(
      "import_jobs_kind_check",
      sql`${table.kind} IN ('contact_import', 'contact_export', 'event_archive')`,
    ),
  ],
);
