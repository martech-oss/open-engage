import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
export const experimentsQueryOptions = (pageId: string) =>
  orpcQuery.website.listExperiments.queryOptions({ input: { pageId } });
export const dynamicContentsQueryOptions = (pageId: string) =>
  orpcQuery.website.listDynamicContent.queryOptions({ input: { pageId } });
export const optimizationSegmentOptions = () => orpcQuery.segments.list.queryOptions();
export const experimentReportQueryOptions = (input: { id: string; from: string; to: string }) =>
  orpcQuery.website.experimentReport.queryOptions({ input });
function useInvalidation() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: orpcQuery.website.key() });
}
export function useCreateExperiment() {
  return useMutation(
    orpcQuery.website.createExperiment.mutationOptions({ onSuccess: useInvalidation() }),
  );
}
export function useStartExperiment() {
  return useMutation(
    orpcQuery.website.startExperiment.mutationOptions({ onSuccess: useInvalidation() }),
  );
}
export function useEndExperiment() {
  return useMutation(
    orpcQuery.website.endExperiment.mutationOptions({ onSuccess: useInvalidation() }),
  );
}
export function useSaveDynamicContent() {
  return useMutation(
    orpcQuery.website.saveDynamicContent.mutationOptions({ onSuccess: useInvalidation() }),
  );
}
