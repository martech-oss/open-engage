import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import { invalidateProjectBriefQueries } from "@/lib/project-brief-cache";
import type { SegmentFilter } from "@openengage/core/segments";

export function segmentsQueryOptions() {
  return orpcQuery.segments.list.queryOptions();
}

export function segmentOptionsQueryOptions() {
  return orpcQuery.segments.options.queryOptions();
}

export function invalidateSegmentsList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: orpcQuery.segments.list.key() });
}

export function createDynamicSegment(input: { name: string; slug: string; filter: SegmentFilter }) {
  return orpc.segments.create({ ...input, kind: "dynamic" });
}

export function useCreateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.create.mutationOptions(),
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateSegmentsList(queryClient),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]);
    },
  });
}

export function useUpdateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.update.mutationOptions(),
    onSuccess: () => invalidateSegmentsList(queryClient),
  });
}

export function usePreviewSegment() {
  return useMutation(orpcQuery.segments.preview.mutationOptions());
}

export function useValidateSegment() {
  return useMutation(orpcQuery.segments.validate.mutationOptions());
}

export function useGenerateSegment() {
  return useMutation(orpcQuery.segments.generate.mutationOptions());
}

export function useRefreshSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.refresh.mutationOptions(),
    onSuccess: () => invalidateSegmentsList(queryClient),
  });
}

export function refreshSegment(segmentId: string) {
  return orpc.segments.refresh({ id: segmentId });
}
