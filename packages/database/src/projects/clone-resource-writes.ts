import type { BatchItem } from "drizzle-orm/batch";

import type { ProjectCloneResourceKind } from "@openengage/core/projects";

import { automations, automationVersions } from "../automations/schema";
import type { Database } from "../client";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";
import { dynamicContents, landingExperiments } from "../web/optimization-schema";
import {
  customRedirects,
  forms,
  formVersions,
  landingPages,
  landingPageVersions,
} from "../web/schema";
import { formProgramBindings } from "./form-program-schema";
import { projectPrograms } from "./program-schema";
import { projectBriefs, projects } from "./schema";
import { projectVariables } from "./variable-schema";
type CloneWriteBuilder = (orm: Database, row: Record<string, unknown>) => BatchItem<"sqlite">;
/** This fixed typed registry is the only materialization table whitelist. */
export const projectCloneWrites = {
  project: (orm, row) => orm.insert(projects).values(row as typeof projects.$inferInsert),
  brief: (orm, row) => orm.insert(projectBriefs).values(row as typeof projectBriefs.$inferInsert),
  program: (orm, row) =>
    orm.insert(projectPrograms).values(row as typeof projectPrograms.$inferInsert),
  variable: (orm, row) =>
    orm.insert(projectVariables).values(row as typeof projectVariables.$inferInsert),
  automation: (orm, row) => orm.insert(automations).values(row as typeof automations.$inferInsert),
  automation_version: (orm, row) =>
    orm.insert(automationVersions).values(row as typeof automationVersions.$inferInsert),
  form: (orm, row) => orm.insert(forms).values(row as typeof forms.$inferInsert),
  form_version: (orm, row) =>
    orm.insert(formVersions).values(row as typeof formVersions.$inferInsert),
  form_binding: (orm, row) =>
    orm.insert(formProgramBindings).values(row as typeof formProgramBindings.$inferInsert),
  landing_page: (orm, row) =>
    orm.insert(landingPages).values(row as typeof landingPages.$inferInsert),
  landing_page_version: (orm, row) =>
    orm.insert(landingPageVersions).values(row as typeof landingPageVersions.$inferInsert),
  experiment: (orm, row) =>
    orm.insert(landingExperiments).values(row as typeof landingExperiments.$inferInsert),
  dynamic_content: (orm, row) =>
    orm.insert(dynamicContents).values(row as typeof dynamicContents.$inferInsert),
  segment: (orm, row) => orm.insert(segments).values(row as typeof segments.$inferInsert),
  redirect: (orm, row) =>
    orm.insert(customRedirects).values(row as typeof customRedirects.$inferInsert),
  email_sequence: (orm, row) =>
    orm.insert(emailTemplates).values(row as typeof emailTemplates.$inferInsert),
} satisfies Record<ProjectCloneResourceKind, CloneWriteBuilder>;
/** Briefs are additionally deferred until initial Project links exist. */
export const projectCloneWriteOrder = {
  project: 0,
  brief: 1,
  variable: 1,
  program: 1,
  form: 2,
  landing_page: 2,
  automation: 2,
  segment: 2,
  email_sequence: 2,
  redirect: 2,
  form_version: 3,
  form_binding: 3,
  landing_page_version: 4,
  automation_version: 4,
  experiment: 5,
  dynamic_content: 5,
} satisfies Record<ProjectCloneResourceKind, number>;
