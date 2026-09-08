import { foreignKey, primaryKey, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { forms } from "../web/schema";
import { projectProgramVersions } from "./program-schema";
export const formProgramBindings = sqliteTable(
  "form_program_bindings",
  {
    workspaceId: text("workspace_id").notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    definitionVersion: integer("definition_version"),
    statusId: text("status_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.formId] }),
    foreignKey({
      columns: [t.workspaceId, t.projectId, t.definitionVersion],
      foreignColumns: [
        projectProgramVersions.workspaceId,
        projectProgramVersions.projectId,
        projectProgramVersions.version,
      ],
    }),
  ],
);
