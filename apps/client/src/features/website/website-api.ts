import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
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
  SiteTracking,
};

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
  return useInvalidatingMutation(orpcQuery.website.createFormHandler.mutationOptions(), [
    orpcQuery.website.listFormHandlers.key(),
  ]);
}
export function useUpdateFormHandler() {
  return useInvalidatingMutation(orpcQuery.website.updateFormHandler.mutationOptions(), [
    orpcQuery.website.listFormHandlers.key(),
  ]);
}
export function useDeleteFormHandler() {
  return useInvalidatingMutation(orpcQuery.website.deleteFormHandler.mutationOptions(), [
    orpcQuery.website.listFormHandlers.key(),
  ]);
}
export function useGenerateLandingPage() {
  return useInvalidatingMutation(orpcQuery.website.generatePage.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
export function useRetryLandingGeneration() {
  return useInvalidatingMutation(orpcQuery.website.retryPageGeneration.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
export function usePublishLandingPage() {
  return useInvalidatingMutation(orpcQuery.website.publishPage.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
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
  return useInvalidatingMutation(orpcQuery.website.createForm.mutationOptions(), [
    orpcQuery.website.listForms.key(),
  ]);
}

export function useUpdateSignupForm() {
  return useInvalidatingMutation(orpcQuery.website.updateForm.mutationOptions(), [
    orpcQuery.website.listForms.key(),
  ]);
}

export function useArchiveSignupForm() {
  return useInvalidatingMutation(orpcQuery.website.archiveForm.mutationOptions(), [
    orpcQuery.website.listForms.key(),
  ]);
}

export function useCreateLandingPage() {
  return useInvalidatingMutation(orpcQuery.website.createPage.mutationOptions(), [
    orpcQuery.website.listPages.key(),
  ]);
}

export function useUpdateLandingPage() {
  return useInvalidatingMutation(orpcQuery.website.updatePage.mutationOptions(), [
    orpcQuery.website.listPages.key(),
  ]);
}

export function useArchiveLandingPage() {
  return useInvalidatingMutation(orpcQuery.website.archivePage.mutationOptions(), [
    orpcQuery.website.listPages.key(),
  ]);
}

export function useCreateSiteMessage() {
  return useInvalidatingMutation(orpcQuery.website.createMessage.mutationOptions(), [
    orpcQuery.website.listMessages.key(),
  ]);
}

export function useUpdateSiteMessage() {
  return useInvalidatingMutation(orpcQuery.website.updateMessage.mutationOptions(), [
    orpcQuery.website.listMessages.key(),
  ]);
}

export function useArchiveSiteMessage() {
  return useInvalidatingMutation(orpcQuery.website.archiveMessage.mutationOptions(), [
    orpcQuery.website.listMessages.key(),
  ]);
}

export function useUpdateSiteTracking() {
  return useInvalidatingMutation(orpcQuery.website.updateTracking.mutationOptions(), [
    orpcQuery.website.getTracking.key(),
  ]);
}

export function useCreateCustomRedirect() {
  return useInvalidatingMutation(orpcQuery.website.createRedirect.mutationOptions(), [
    orpcQuery.website.listRedirects.key(),
  ]);
}

export function useUpdateCustomRedirect() {
  return useInvalidatingMutation(orpcQuery.website.updateRedirect.mutationOptions(), [
    orpcQuery.website.listRedirects.key(),
  ]);
}

export function useArchiveCustomRedirect() {
  return useInvalidatingMutation(orpcQuery.website.archiveRedirect.mutationOptions(), [
    orpcQuery.website.listRedirects.key(),
  ]);
}
