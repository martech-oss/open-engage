import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

export function projectBriefsQueryOptions() {
  return orpcQuery.projects.briefList.queryOptions();
}

export function projectBriefOptionsQueryOptions() {
  return orpcQuery.projects.briefOptions.queryOptions();
}

export function projectBriefQueryOptions(id: string) {
  return orpcQuery.projects.briefGet.queryOptions({ input: { id } });
}

function useBriefInvalidator() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpcQuery.projects.briefList.key() }),
      queryClient.invalidateQueries({ queryKey: orpcQuery.projects.briefGet.key() }),
    ]);
  };
}

export function useCreateProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefCreate.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useUpdateProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefUpdate.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useSubmitProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefSubmit.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useApproveProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefApprove.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useRejectProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefReject.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useReopenProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefReopen.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useCompleteProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefComplete.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useArchiveProjectBrief() {
  return useMutation({
    ...orpcQuery.projects.briefArchive.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useAddProjectBriefItem() {
  return useMutation({
    ...orpcQuery.projects.briefAddItem.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useRemoveProjectBriefItem() {
  return useMutation({
    ...orpcQuery.projects.briefRemoveItem.mutationOptions(),
    onSuccess: useBriefInvalidator(),
  });
}
export function useGenerateProjectBrief() {
  return useMutation(orpcQuery.projects.briefGenerate.mutationOptions());
}
