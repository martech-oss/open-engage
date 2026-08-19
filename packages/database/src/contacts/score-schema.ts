import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { automationEnrollments } from "../automations/schema";
import { scoringRules } from "../scoring/schema";
import { contactEvents, contacts } from "./schema";

/**
 * Bridge table between Contacts and Automation. Keeping it outside either
 * aggregate's base schema prevents the two schema modules from importing one
 * another.
 */
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
