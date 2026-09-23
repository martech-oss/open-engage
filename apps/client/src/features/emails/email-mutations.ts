import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import { invalidateQueryRoots } from "@/lib/query-invalidation";

export function invalidateEmailTemplateQueries(queryClient: QueryClient): Promise<void> {
  return invalidateQueryRoots(queryClient, orpcQuery.emails.listTemplates.key());
}

export function invalidateEmailVariableQueries(queryClient: QueryClient): Promise<void> {
  return invalidateQueryRoots(queryClient, orpcQuery.emails.listVariables.key());
}

export function useCreateEmailTemplate() {
  return useInvalidatingMutation(
    orpcQuery.emails.createTemplate.mutationOptions(),
    invalidateEmailTemplateQueries,
  );
}

export function useGenerateEmailTemplate() {
  return useMutation(orpcQuery.emails.generateTemplate.mutationOptions());
}

export function useGenerateEmailImage() {
  return useMutation(orpcQuery.emails.generateImage.mutationOptions());
}

export function useUpdateEmailTemplate() {
  return useInvalidatingMutation(
    orpcQuery.emails.updateTemplate.mutationOptions(),
    invalidateEmailTemplateQueries,
  );
}

/** Rendering a preview does not write to any stored template. */
export function usePreviewEmailTemplate() {
  return useMutation(orpcQuery.emails.previewTemplate.mutationOptions());
}

export function usePublishEmailTemplate() {
  return useInvalidatingMutation(
    orpcQuery.emails.publishTemplate.mutationOptions(),
    invalidateEmailTemplateQueries,
  );
}

export function useArchiveEmailTemplate() {
  return useInvalidatingMutation(
    orpcQuery.emails.archiveTemplate.mutationOptions(),
    invalidateEmailTemplateQueries,
  );
}

export function useCreateEmailVariable() {
  return useInvalidatingMutation(
    orpcQuery.emails.createVariable.mutationOptions(),
    invalidateEmailVariableQueries,
  );
}

export function useUpdateEmailVariable() {
  return useInvalidatingMutation(
    orpcQuery.emails.updateVariable.mutationOptions(),
    invalidateEmailVariableQueries,
  );
}

export function useArchiveEmailVariable() {
  return useInvalidatingMutation(
    orpcQuery.emails.archiveVariable.mutationOptions(),
    invalidateEmailVariableQueries,
  );
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
  return useInvalidatingMutation(orpcQuery.emails.updateTrackingSettings.mutationOptions(), [
    orpcQuery.emails.getTrackingSettings.key(),
  ]);
}
