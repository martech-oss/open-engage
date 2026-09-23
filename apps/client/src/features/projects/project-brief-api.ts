import { type QueryClient, useMutation } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
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

function invalidateBriefWrites(queryClient: QueryClient) {
  return Promise.all([
    invalidateProjectBriefQueries(queryClient),
    queryClient.invalidateQueries({ queryKey: orpcQuery.projects.key() }),
  ]);
}

export function useCreateProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefCreate.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useUpdateProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefUpdate.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useSubmitProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefSubmit.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useApproveProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefApprove.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useRejectProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefReject.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useWithdrawProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefWithdraw.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useReopenProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefReopen.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useCompleteProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefComplete.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useArchiveProjectBrief() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefArchive.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useAddProjectBriefItem() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefAddItem.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useRemoveProjectBriefItem() {
  return useInvalidatingMutation(
    orpcQuery.projects.briefRemoveItem.mutationOptions(),
    invalidateBriefWrites,
  );
}
export function useGenerateProjectBrief() {
  return useMutation(orpcQuery.projects.briefGenerate.mutationOptions());
}
