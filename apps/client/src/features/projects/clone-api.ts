import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

export function projectCloneListQueryOptions(id: string) {
  return orpcQuery.projects.cloneList.queryOptions({ input: { id } });
}
export function projectCloneQueryOptions(id: string, jobId: string) {
  return orpcQuery.projects.cloneGet.queryOptions({ input: { id, jobId } });
}
function useInvalidateClones() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: orpcQuery.projects.key() });
}
export function usePreviewProjectClone() {
  return useMutation({
    ...orpcQuery.projects.clonePreview.mutationOptions(),
    onSuccess: useInvalidateClones(),
  });
}
export function useStartProjectClone() {
  return useMutation({
    ...orpcQuery.projects.cloneStart.mutationOptions(),
    onSuccess: useInvalidateClones(),
  });
}
export function useRetryProjectClone() {
  return useMutation({
    ...orpcQuery.projects.cloneRetry.mutationOptions(),
    onSuccess: useInvalidateClones(),
  });
}
