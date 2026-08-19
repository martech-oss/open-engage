import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";
import { companies, contacts } from "../contacts/schema";

export const dealPipelines = sqliteTable(
  "deal_pipelines",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deal_pipelines_workspace_archived_idx").on(table.workspaceId, table.archivedAt),
    uniqueIndex("deal_pipelines_workspace_name_unique").on(table.workspaceId, table.name),
    uniqueIndex("deal_pipelines_workspace_default_unique")
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = 1 AND ${table.archivedAt} IS NULL`),
  ],
);

export const dealStages = sqliteTable(
  "deal_stages",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => dealPipelines.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().default("#64748b").notNull(),
    position: integer().notNull(),
    probability: integer().default(0).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("deal_stages_pipeline_position_unique").on(table.pipelineId, table.position),
    index("deal_stages_workspace_pipeline_idx").on(table.workspaceId, table.pipelineId),
    check(
      "deal_stages_probability_check",
      sql`${table.probability} >= 0 AND ${table.probability} <= 100`,
    ),
  ],
);

export const deals = sqliteTable(
  "deals",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => dealPipelines.id, { onDelete: "restrict" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => dealStages.id, { onDelete: "restrict" }),
    name: text().notNull(),
    value: integer().default(0).notNull(),
    currency: text().default("JPY").notNull(),
    status: text().default("open").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    expectedCloseDate: text("expected_close_date"),
    description: text().default("").notNull(),
    wonAt: text("won_at"),
    lostAt: text("lost_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deals_workspace_pipeline_stage_idx").on(
      table.workspaceId,
      table.pipelineId,
      table.stageId,
      table.status,
    ),
    index("deals_workspace_owner_idx").on(table.workspaceId, table.ownerUserId, table.status),
    index("deals_workspace_contact_idx").on(table.workspaceId, table.contactId),
    index("deals_workspace_company_idx").on(table.workspaceId, table.companyId),
    index("deals_workspace_updated_idx").on(table.workspaceId, table.archivedAt, table.updatedAt),
    index("deals_workspace_currency_created_idx").on(
      table.workspaceId,
      table.currency,
      table.createdAt,
    ),
    index("deals_workspace_currency_won_idx").on(table.workspaceId, table.currency, table.wonAt),
    index("deals_workspace_currency_lost_idx").on(table.workspaceId, table.currency, table.lostAt),
    index("deals_workspace_currency_close_idx").on(
      table.workspaceId,
      table.currency,
      table.status,
      table.expectedCloseDate,
    ),
    check("deals_value_check", sql`${table.value} >= 0`),
    check("deals_status_check", sql`${table.status} IN ('open', 'won', 'lost')`),
    check("deals_currency_check", sql`length(${table.currency}) = 3`),
  ],
);

export const dealTasks = sqliteTable(
  "deal_tasks",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    type: text().default("task").notNull(),
    title: text().notNull(),
    notes: text().default("").notNull(),
    dueAt: text("due_at"),
    status: text().default("open").notNull(),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deal_tasks_workspace_deal_status_idx").on(
      table.workspaceId,
      table.dealId,
      table.status,
      table.dueAt,
    ),
    index("deal_tasks_workspace_assignee_idx").on(
      table.workspaceId,
      table.assignedUserId,
      table.status,
      table.dueAt,
    ),
    index("deal_tasks_workspace_status_completed_idx").on(
      table.workspaceId,
      table.status,
      table.completedAt,
    ),
    check("deal_tasks_type_check", sql`${table.type} IN ('task', 'call', 'email', 'meeting')`),
    check("deal_tasks_status_check", sql`${table.status} IN ('open', 'completed')`),
  ],
);
