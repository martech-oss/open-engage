import { type QueryClient, useMutation } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpc, orpcQuery } from "@/lib/orpc";
import { invalidateProjectBriefQueries } from "@/lib/project-brief-cache";
import { invalidateQueryRoots } from "@/lib/query-invalidation";
import type { SegmentFilter } from "@openengage/core/segments";

export function invalidateSegmentsList(queryClient: QueryClient): Promise<void> {
  return invalidateQueryRoots(queryClient, orpcQuery.segments.list.key());
}

export function invalidateSegmentQueries(
  queryClient: QueryClient,
  segmentId?: string,
): Promise<void> {
  return invalidateQueryRoots(
    queryClient,
    orpcQuery.segments.list.key(),
    segmentId
      ? orpcQuery.segments.get.key({ input: { id: segmentId } })
      : orpcQuery.segments.get.key(),
    orpcQuery.contacts.options.key(),
  );
}

export function createDynamicSegment(input: {
  name: string;
  slug?: string;
  filter: SegmentFilter;
}) {
  return orpc.segments.create({ ...input, kind: "dynamic" });
}

export function useCreateSegment() {
  return useInvalidatingMutation(
    orpcQuery.segments.create.mutationOptions(),
    (queryClient, variables) =>
      Promise.all([
        invalidateSegmentQueries(queryClient),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]),
  );
}

export function useUpdateSegment() {
  return useInvalidatingMutation(
    orpcQuery.segments.update.mutationOptions(),
    (queryClient, variables) => invalidateSegmentQueries(queryClient, variables.id),
  );
}

export function usePreviewSegment() {
  return useMutation(orpcQuery.segments.preview.mutationOptions());
}

export function useGenerateSegment() {
  return useMutation(orpcQuery.segments.generate.mutationOptions());
}

export function useRefreshSegment() {
  return useInvalidatingMutation(
    orpcQuery.segments.refresh.mutationOptions(),
    (queryClient, variables) => invalidateSegmentQueries(queryClient, variables.id),
  );
}

export function refreshSegment(segmentId: string) {
  return orpc.segments.refresh({ id: segmentId });
}
