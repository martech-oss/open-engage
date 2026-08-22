import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

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
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.create.mutationOptions(),
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateSegmentQueries(queryClient),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]);
    },
  });
}

export function useUpdateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.update.mutationOptions(),
    onSuccess: (_data, variables) => invalidateSegmentQueries(queryClient, variables.id),
  });
}

export function usePreviewSegment() {
  return useMutation(orpcQuery.segments.preview.mutationOptions());
}

export function useGenerateSegment() {
  return useMutation(orpcQuery.segments.generate.mutationOptions());
}

export function useRefreshSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.refresh.mutationOptions(),
    onSuccess: (_data, variables) => invalidateSegmentQueries(queryClient, variables.id),
  });
}

export function refreshSegment(segmentId: string) {
  return orpc.segments.refresh({ id: segmentId });
}
