import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import type {
  CustomRedirect,
  LandingPage,
  PublishStatus,
  SignupForm,
  SignupFormDefinition,
  SiteMessage,
  SiteTracking,
} from "@openengage/core/web";

export type {
  CustomRedirect,
  LandingPage,
  PublishStatus,
  SignupForm,
  SignupFormDefinition,
  SiteMessage,
};

/** Retained aliases so the page components read the same as before the migration. */
export type SignupFormRow = SignupForm;
export type LandingPageRow = LandingPage;
export type SiteMessageRow = SiteMessage;
export type CustomRedirectRow = CustomRedirect;
export type SiteTrackingData = SiteTracking;
export type TrackingTopPage = SiteTracking["topPages"][number];

export function signupFormsQueryOptions() {
  return orpcQuery.website.listForms.queryOptions();
}

export function landingPagesQueryOptions() {
  return orpcQuery.website.listPages.queryOptions();
}

export function landingPageDesignQueryOptions(id: string) {
  return orpcQuery.website.getPageDesign.queryOptions({ input: { id } });
}
export function formHandlersQueryOptions() {
  return orpcQuery.website.listFormHandlers.queryOptions();
}
export function useCreateFormHandler() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.website.createFormHandler.mutationOptions(),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: orpcQuery.website.listFormHandlers.key() }),
  });
}
export function useUpdateFormHandler() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updateFormHandler.mutationOptions(),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: orpcQuery.website.listFormHandlers.key() }),
  });
}
export function useDeleteFormHandler() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.website.deleteFormHandler.mutationOptions(),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: orpcQuery.website.listFormHandlers.key() }),
  });
}
export function useGenerateLandingPage() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.website.generatePage.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: orpcQuery.website.key() }),
  });
}
export function usePublishLandingPage() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.website.publishPage.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: orpcQuery.website.key() }),
  });
}

export function siteMessagesQueryOptions() {
  return orpcQuery.website.listMessages.queryOptions();
}

export function customRedirectsQueryOptions() {
  return orpcQuery.website.listRedirects.queryOptions();
}

export function siteTrackingQueryOptions() {
  return orpcQuery.website.getTracking.queryOptions();
}

export function useCreateSignupForm() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.createForm.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listForms.key() }),
  });
}

export function useUpdateSignupForm() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updateForm.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listForms.key() }),
  });
}

export function useArchiveSignupForm() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.archiveForm.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listForms.key() }),
  });
}

export function useCreateLandingPage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.createPage.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listPages.key() }),
  });
}

export function useUpdateLandingPage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updatePage.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listPages.key() }),
  });
}

export function useArchiveLandingPage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.archivePage.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listPages.key() }),
  });
}

export function useCreateSiteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.createMessage.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.website.listMessages.key() }),
  });
}

export function useUpdateSiteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updateMessage.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.website.listMessages.key() }),
  });
}

export function useArchiveSiteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.archiveMessage.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.website.listMessages.key() }),
  });
}

export function useUpdateSiteTracking() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updateTracking.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpcQuery.website.getTracking.key() }),
  });
}

function invalidateRedirects(queryClient: ReturnType<typeof useQueryClient>) {
  return () => queryClient.invalidateQueries({ queryKey: orpcQuery.website.listRedirects.key() });
}

export function useCreateCustomRedirect() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.createRedirect.mutationOptions(),
    onSuccess: invalidateRedirects(queryClient),
  });
}

export function useUpdateCustomRedirect() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.updateRedirect.mutationOptions(),
    onSuccess: invalidateRedirects(queryClient),
  });
}

export function useArchiveCustomRedirect() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.website.archiveRedirect.mutationOptions(),
    onSuccess: invalidateRedirects(queryClient),
  });
}
