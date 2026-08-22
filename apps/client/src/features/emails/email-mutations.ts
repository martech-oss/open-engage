import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import { invalidateQueryRoots } from "@/lib/query-invalidation";

export function invalidateEmailTemplateQueries(queryClient: QueryClient): Promise<void> {
  return invalidateQueryRoots(queryClient, orpcQuery.emails.listTemplates.key());
}

export function invalidateEmailVariableQueries(queryClient: QueryClient): Promise<void> {
  return invalidateQueryRoots(queryClient, orpcQuery.emails.listVariables.key());
}

export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.createTemplate.mutationOptions(),
    onSuccess: () => invalidateEmailTemplateQueries(queryClient),
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
    onSuccess: () => invalidateEmailTemplateQueries(queryClient),
  });
}

/** Rendering a preview does not write to any stored template. */
export function usePreviewEmailTemplate() {
  return useMutation(orpcQuery.emails.previewTemplate.mutationOptions());
}

export function usePublishEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.publishTemplate.mutationOptions(),
    onSuccess: () => invalidateEmailTemplateQueries(queryClient),
  });
}

export function useArchiveEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.archiveTemplate.mutationOptions(),
    onSuccess: () => invalidateEmailTemplateQueries(queryClient),
  });
}

export function useCreateEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.createVariable.mutationOptions(),
    onSuccess: () => invalidateEmailVariableQueries(queryClient),
  });
}

export function useUpdateEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.updateVariable.mutationOptions(),
    onSuccess: () => invalidateEmailVariableQueries(queryClient),
  });
}

export function useArchiveEmailVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.archiveVariable.mutationOptions(),
    onSuccess: () => invalidateEmailVariableQueries(queryClient),
  });
}

export function useUpdateEmailBrandProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.workspace.updateEmailBrand.mutationOptions(),
    onSuccess: (profile) =>
      queryClient.setQueryData(orpcQuery.workspace.getEmailBrand.key(), profile),
  });
}

export function useUpdateEmailTrackingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.emails.updateTrackingSettings.mutationOptions(),
    onSuccess: () => invalidateQueryRoots(queryClient, orpcQuery.emails.getTrackingSettings.key()),
  });
}
