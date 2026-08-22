import { orpcQuery } from "@/lib/orpc";
import type { EmailBrandProfile, EmailTemplate, MessageVariable } from "@openengage/core/messaging";

export type { EmailTemplate, MessageVariable, EmailBrandProfile };
export type EmailTemplateRow = EmailTemplate;
export type MessageVariableRow = MessageVariable;

export function emailArchivedTemplatesQueryOptions() {
  return orpcQuery.emails.listTemplates.queryOptions({ input: { archived: true } });
}

export function emailVariablesListQueryOptions() {
  return orpcQuery.emails.listVariables.queryOptions({ input: { archived: false } });
}

export function emailTrackingSettingsQueryOptions() {
  return orpcQuery.emails.getTrackingSettings.queryOptions();
}

export function emailBrandProfileQueryOptions() {
  return orpcQuery.workspace.getEmailBrand.queryOptions();
}

/** The editor filters this list to published Transactional templates. */
export function emailTemplateOptionsQueryOptions() {
  return orpcQuery.emails.listTemplates.queryOptions({ input: { archived: false } });
}
