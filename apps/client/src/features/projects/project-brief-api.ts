import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import { invalidateProjectBriefQueries } from "@/lib/project-brief-cache";

export function projectBriefsQueryOptions() {
  return orpcQuery.projects.briefList.queryOptions();
}

export function projectBriefOptionsQueryOptions() {
  return orpcQuery.projects.briefOptions.queryOptions();
}

export function projectBriefQueryOptions(id: string) {
  return orpcQuery.projects.briefGet.queryOptions({ input: { id } });
}

export function useProjectBriefInvalidator() {
  const queryClient = useQueryClient();
  return () => invalidateProjectBriefQueries(queryClient);
}

export function useCreateProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefCreate.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useUpdateProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefUpdate.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useSubmitProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefSubmit.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useApproveProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefApprove.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useRejectProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefReject.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useWithdrawProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefWithdraw.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useReopenProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefReopen.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useCompleteProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefComplete.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useArchiveProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefArchive.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useAddProjectBriefItem() {
  return useMutation({
    ...orpcQuery.projects.briefAddItem.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useRemoveProjectBriefItem() {
  return useMutation({
    ...orpcQuery.projects.briefRemoveItem.mutationOptions(),
    onSuccess: useProjectBriefInvalidator(),
  });
}
export function useGenerateProjectBrief() {
  return useMutation(orpcQuery.projects.briefGenerate.mutationOptions());
}
