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

import { contacts } from "../contacts/schema";
import { projects } from "./schema";

export const projectPrograms = sqliteTable(
  "project_programs",
  {
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    definition: text().notNull(),
    rowVersion: integer("row_version").notNull().default(1),
    publishedVersion: integer("published_version"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.projectId] }),
    foreignKey({
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    check("project_programs_definition_json", sql`json_valid(${t.definition})`),
    check("project_programs_revision", sql`${t.rowVersion}>0`),
  ],
);
export const projectProgramVersions = sqliteTable(
  "project_program_versions",
  {
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    version: integer().notNull(),
    definition: text().notNull(),
    publishedAt: text("published_at").notNull(),
    publishedBy: text("published_by"),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.projectId, t.version] }),
    foreignKey({
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    check("project_program_versions_definition_json", sql`json_valid(${t.definition})`),
    check("project_program_versions_positive", sql`${t.version}>0`),
  ],
);
export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    contactId: text("contact_id").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    statusId: text("status_id").notNull(),
    statusLabel: text("status_label").notNull(),
    joinedAt: text("joined_at").notNull(),
    firstSuccessAt: text("first_success_at"),
    source: text().notNull(),
    revision: integer().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("project_members_workspace_project_contact_unique").on(
      t.workspaceId,
      t.projectId,
      t.contactId,
    ),
    uniqueIndex("project_members_workspace_id_unique").on(t.workspaceId, t.id),
    index("project_members_cohort_idx").on(t.workspaceId, t.projectId, t.joinedAt),
    index("project_members_contact_idx").on(t.workspaceId, t.contactId),
    foreignKey({
      columns: [t.workspaceId, t.projectId, t.definitionVersion],
      foreignColumns: [
        projectProgramVersions.workspaceId,
        projectProgramVersions.projectId,
        projectProgramVersions.version,
      ],
    }),
    foreignKey({
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("cascade"),
    check("project_members_revision", sql`${t.revision}>0`),
    check(
      "project_members_success_time",
      sql`${t.firstSuccessAt} IS NULL OR ${t.firstSuccessAt} >= ${t.joinedAt}`,
    ),
  ],
);
export const projectMemberTransitions = sqliteTable(
  "project_member_transitions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    memberId: text("member_id").notNull(),
    contactId: text("contact_id").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    revision: integer().notNull(),
    previousStatusId: text("previous_status_id"),
    statusId: text("status_id").notNull(),
    statusLabel: text("status_label").notNull(),
    success: integer({ mode: "boolean" }).notNull(),
    firstSuccessAt: text("first_success_at"),
    source: text().notNull(),
    mode: text().notNull(),
    reason: text(),
    actorUserId: text("actor_user_id"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("project_member_transitions_revision_unique").on(
      t.workspaceId,
      t.memberId,
      t.revision,
    ),
    index("project_member_transitions_asof_idx").on(
      t.workspaceId,
      t.projectId,
      t.memberId,
      t.occurredAt,
    ),
    foreignKey({
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [projectMembers.workspaceId, projectMembers.id],
    }).onDelete("cascade"),
    check(
      "project_member_transitions_correction_reason",
      sql`${t.mode} = 'progress' OR (${t.mode}='correction' AND ${t.source}='manual' AND length(trim(${t.reason}))>0)`,
    ),
  ],
);
/** A no-op is also a durable command result, so later progress cannot change replay meaning. */
export const projectMemberCommands = sqliteTable(
  "project_member_commands",
  {
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text().notNull(),
    result: text().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.projectId, t.idempotencyKey] }),
    foreignKey({
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    check("project_member_commands_result_json", sql`json_valid(${t.result})`),
  ],
);
