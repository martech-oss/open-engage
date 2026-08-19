import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import type {
  EmailBrandProfile,
  EmailSegmentOption,
  EmailTemplate,
  EmailTrackingSettings,
  MessageVariable,
} from "@openengage/core/messaging";

export type { EmailTemplate, MessageVariable };
export type { EmailBrandProfile, EmailTrackingSettings };

/** Retained aliases so the table and form components read the same. */
export type EmailTemplateRow = EmailTemplate;
export type MessageVariableRow = MessageVariable;
export type SegmentOption = EmailSegmentOption;

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

export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.createTemplate.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
  });
}

export function useGenerateEmailTemplate() {
  return useMutation(orpcQuery.emails.generateTemplate.mutationOptions());
}

export function useGenerateEmailImage() {
  return useMutation(orpcQuery.emails.generateImage.mutationOptions());
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.updateTemplate.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
  });
}

/** No built-in invalidation: rendering a preview doesn't write to any stored template. */
export function usePreviewEmailTemplate() {
  return useMutation(orpcQuery.emails.previewTemplate.mutationOptions());
}

export function usePublishEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.publishTemplate.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
  });
}

export function useArchiveEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.archiveTemplate.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
  });
}

export function useCreateEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.createVariable.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listVariables.key() }),
  });
}

export function useUpdateEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.updateVariable.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listVariables.key() }),
  });
}

export function useArchiveEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.archiveVariable.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listVariables.key() }),
  });
}

export function useUpdateEmailBrandProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.workspace.updateEmailBrand.mutationOptions(),
    onSuccess: (profile) => {
      queryClient.setQueryData(orpcQuery.workspace.getEmailBrand.key(), profile);
    },
  });
}

export function useUpdateEmailTrackingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.updateTrackingSettings.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.emails.getTrackingSettings.key() }),
  });
}
