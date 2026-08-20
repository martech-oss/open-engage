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

export const automations = sqliteTable(
  "automations",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().default("").notNull(),
    status: text().default("draft").notNull(),
    draftVersionId: text("draft_version_id"),
    publishedVersionId: text("published_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("automations_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    check(
      "automations_status_check",
      sql`${table.status} IN ('draft', 'active', 'paused', 'archived')`,
    ),
  ],
);

export const automationVersions = sqliteTable(
  "automation_versions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    status: text().default("draft").notNull(),
    timezone: text().default("UTC").notNull(),
    graph: text().notNull(),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("automation_versions_workspace_automation_version_unique").on(
      table.workspaceId,
      table.automationId,
      table.version,
    ),
    check("automation_versions_status_check", sql`${table.status} IN ('draft', 'published')`),
  ],
);

export const automationTriggers = sqliteTable(
  "automation_triggers",
  {
    automationVersionId: text("automation_version_id")
      .primaryKey()
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").notNull(),
    source: text().notNull(),
    eventType: text("event_type"),
    resourceId: text("resource_id"),
    reentry: text().default("once").notNull(),
    inactivityDays: integer("inactivity_days"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("automation_triggers_workspace_event_idx").on(
      table.workspaceId,
      table.eventType,
      table.resourceId,
    ),
    index("automation_triggers_source_idx").on(table.source, table.workspaceId),
    check(
      "automation_triggers_source_check",
      sql`${table.source} IN ('segment_joined', 'form_submitted', 'contact_created', 'api_event', 'webhook_event', 'contact_inactive')`,
    ),
    check("automation_triggers_reentry_check", sql`${table.reentry} IN ('once', 'every_time')`),
  ],
);

export const automationEnrollments = sqliteTable(
  "automation_enrollments",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    automationVersionId: text("automation_version_id")
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id"),
    status: text().default("active").notNull(),
    currentNodeId: text("current_node_id"),
    enteredAt: text("entered_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("automation_enrollments_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("automation_enrollments_workspace_automation_entered_idx").on(
      table.workspaceId,
      table.automationId,
      table.enteredAt,
    ),
    index("automation_enrollments_workspace_completed_idx").on(
      table.workspaceId,
      table.completedAt,
    ),
    uniqueIndex("automation_enrollment_source_unique").on(
      table.workspaceId,
      table.automationId,
      table.contactId,
      table.sourceEventId,
    ),
    check(
      "automation_enrollments_status_check",
      sql`${table.status} IN ('active', 'completed', 'cancelled', 'failed')`,
    ),
  ],
);

export const automationJobs = sqliteTable(
  "automation_jobs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => automationEnrollments.id, { onDelete: "cascade" }),
    automationVersionId: text("automation_version_id")
      .notNull()
      .references(() => automationVersions.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().default("{}").notNull(),
    status: text().default("pending").notNull(),
    dueAt: text("due_at").notNull(),
    leaseId: text("lease_id"),
    leaseUntil: text("lease_until"),
    waitEventType: text("wait_event_type"),
    waitResourceId: text("wait_resource_id"),
    attempts: integer().default(0).notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("automation_jobs_workspace_enrollment_idx").on(
      table.workspaceId,
      table.enrollmentId,
      table.createdAt,
    ),
    // Deliberately NOT workspace-prefixed: the cron claims due jobs across
    // every workspace in one fair-queueing scan (see
    // AutomationEngineRepository.workspacesWithDueJobs), so a global
    // (status, due_at, lease_until) index is the correct shape here.
    index("automation_jobs_due_claim_idx").on(table.status, table.dueAt, table.leaseUntil),
    index("automation_jobs_wait_event_idx").on(
      table.status,
      table.workspaceId,
      table.contactId,
      table.waitEventType,
      table.waitResourceId,
    ),
    uniqueIndex("automation_jobs_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check(
      "automation_jobs_status_check",
      sql`${table.status} IN ('pending', 'leased', 'queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

/** Commit marker for non-idempotent automation action effects. */
export const automationActionEffects = sqliteTable(
  "automation_action_effects",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => automationJobs.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    effect: text().notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.nodeId, table.effect] }),
    index("automation_action_effects_workspace_completed_idx").on(
      table.workspaceId,
      table.completedAt,
    ),
  ],
);

// draftVersionId/publishedVersionId are FK-shaped but left unconstrained: a
// real FK would create automations<->automationVersions as a two-table
// reference cycle at both the DDL and Drizzle-type level (each version also
// points back at its automation). SQLite requires such cycles to be wired
// with `PRAGMA defer_foreign_keys` around every write that touches both
// tables (publish already does a 3-row transaction across them); enforcing
// it store-side isn't worth that complexity when application code is the
// only writer of these two columns.
