import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import type { ProjectCloneCursor } from "@openengage/core/projects";

export function projectCloneListQueryOptions(id: string, cursor?: ProjectCloneCursor) {
  return orpcQuery.projects.cloneList.queryOptions({
    input: { id, ...(cursor ? { cursor } : {}) },
  });
}
export function projectCloneProgressQueryOptions(id: string, jobId: string) {
  return orpcQuery.projects.cloneProgress.queryOptions({ input: { id, jobId } });
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
