import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import type { ProjectCloneCursor } from "@openengage/core/projects";

export function projectCloneListQueryOptions(id: string, cursor?: ProjectCloneCursor) {
  return orpcQuery.projects.cloneList.queryOptions({
    input: { id, ...(cursor ? { cursor } : {}) },
    refetchInterval: (query) =>
      query.state.data?.items.some((job) => ["queued", "running"].includes(job.status))
        ? 3000
        : false,
  });
}
export function projectCloneProgressQueryOptions(id: string, jobId: string) {
  return orpcQuery.projects.cloneProgress.queryOptions({
    input: { id, jobId },
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && ["queued", "running"].includes(query.state.data.status) ? 2000 : false,
  });
}
export function usePreviewProjectClone() {
  return useInvalidatingMutation(orpcQuery.projects.clonePreview.mutationOptions(), [
    orpcQuery.projects.key(),
  ]);
}
export function useStartProjectClone() {
  return useInvalidatingMutation(orpcQuery.projects.cloneStart.mutationOptions(), [
    orpcQuery.projects.key(),
  ]);
}
export function useRetryProjectClone() {
  return useInvalidatingMutation(orpcQuery.projects.cloneRetry.mutationOptions(), [
    orpcQuery.projects.key(),
  ]);
}
