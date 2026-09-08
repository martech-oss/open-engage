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

import { user, organization } from "../auth/schema";

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
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    lifecycleStage: text("lifecycle_stage").default("lead").notNull(),
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
    check(
      "contacts_lifecycle_check",
      sql`${table.lifecycleStage} IN ('lead','mql','sql','customer')`,
    ),
    index("contacts_workspace_owner_lifecycle_idx").on(
      table.workspaceId,
      table.ownerUserId,
      table.lifecycleStage,
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
    uniqueIndex("contacts_workspace_id_unique").on(table.workspaceId, table.id),
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
  (table) => [
    uniqueIndex("tags_workspace_slug_unique").on(table.workspaceId, table.slug),
    uniqueIndex("tags_workspace_id_unique").on(table.workspaceId, table.id),
  ],
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
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "contact_tags_workspace_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.tagId],
      foreignColumns: [tags.workspaceId, tags.id],
      name: "contact_tags_workspace_tag_fk",
    }).onDelete("cascade"),
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
    replayMode: text("replay_mode").default("live").notNull(),
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
    index("contact_events_workspace_occurred_idx").on(table.workspaceId, table.occurredAt),
    index("contact_events_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "contact_events_workspace_contact_fk",
    }),
  ],
);

/** Durable retry marker for contact-event side effects accepted with a public form. */
export const contactEventOutbox = sqliteTable(
  "contact_event_outbox",
  {
    eventId: text("event_id")
      .primaryKey()
      .notNull()
      .references(() => contactEvents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text().default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: text("next_attempt_at"),
    leaseId: text("lease_id"),
    leaseExpiresAt: text("lease_expires_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
  },
  (table) => [
    index("contact_event_outbox_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("contact_event_outbox_pending_due_idx")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index("contact_event_outbox_processing_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'processing'`),
    check(
      "contact_event_outbox_status_check",
      sql`${table.status} IN ('pending', 'processing', 'processed')`,
    ),
  ],
);

/** Independently resumable business effects for one durable contact event. */
export const contactEventProjections = sqliteTable(
  "contact_event_projections",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => contactEvents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projection: text().notNull(),
    status: text().default("pending").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.projection] }),
    index("contact_event_projections_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    check(
      "contact_event_projections_name_check",
      sql`${table.projection} IN ('scoring', 'grade', 'campaign', 'decision_wake', 'automation_enrollment', 'segment_reconcile')`,
    ),
    check(
      "contact_event_projections_status_check",
      sql`${table.status} IN ('pending', 'completed', 'skipped')`,
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

/** Durable ownership and lease state for one contact-import part. */
export const contactImportParts = sqliteTable(
  "contact_import_parts",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    part: integer().notNull(),
    totalParts: integer("total_parts").notNull(),
    status: text().default("pending").notNull(),
    attempts: integer().default(0).notNull(),
    leaseId: text("lease_id"),
    leaseExpiresAt: text("lease_expires_at"),
    /** Stable candidate ids and normalized rows reserved before any insert. */
    candidates: text(),
    /** Unique authority acquired once before the candidate-insert batch mutates contacts. */
    insertPhaseToken: text("insert_phase_token"),
    /** Non-null proves insert phase completion; completed parts expose it as the outbox payload. */
    reconciliationContactIds: text("reconciliation_contact_ids"),
    reconciliationPublishedAt: text("reconciliation_published_at"),
    /** Unique completion winner consumed by parent counters and next-part creation. */
    completionToken: text("completion_token"),
    processed: integer().default(0).notNull(),
    succeeded: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.part] }),
    index("contact_import_parts_pending_idx")
      .on(table.updatedAt, table.jobId, table.part)
      .where(sql`${table.status} = 'pending'`),
    index("contact_import_parts_processing_lease_idx")
      .on(table.leaseExpiresAt, table.jobId, table.part)
      .where(sql`${table.status} = 'processing'`),
    index("contact_import_parts_reconciliation_pending_idx")
      .on(table.updatedAt, table.jobId, table.part)
      .where(
        sql`${table.status} = 'completed' AND ${table.reconciliationContactIds} IS NOT NULL AND ${table.reconciliationPublishedAt} IS NULL`,
      ),
    check(
      "contact_import_parts_status_check",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
    check("contact_import_parts_part_check", sql`${table.part} >= 0`),
    check("contact_import_parts_total_check", sql`${table.totalParts} > ${table.part}`),
    check("contact_import_parts_attempts_check", sql`${table.attempts} BETWEEN 0 AND 5`),
  ],
);
