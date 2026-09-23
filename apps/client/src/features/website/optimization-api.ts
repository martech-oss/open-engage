import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
export const experimentsQueryOptions = (pageId: string) =>
  orpcQuery.website.listExperiments.queryOptions({ input: { pageId } });
export const dynamicContentsQueryOptions = (pageId: string) =>
  orpcQuery.website.listDynamicContent.queryOptions({ input: { pageId } });
export const optimizationSegmentOptions = () => orpcQuery.segments.list.queryOptions();
export const experimentReportQueryOptions = (input: { id: string; from: string; to: string }) =>
  orpcQuery.website.experimentReport.queryOptions({ input });
export function useCreateExperiment() {
  return useInvalidatingMutation(orpcQuery.website.createExperiment.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
export function useStartExperiment() {
  return useInvalidatingMutation(orpcQuery.website.startExperiment.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
export function useEndExperiment() {
  return useInvalidatingMutation(orpcQuery.website.endExperiment.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
export function useSaveDynamicContent() {
  return useInvalidatingMutation(orpcQuery.website.saveDynamicContent.mutationOptions(), [
    orpcQuery.website.key(),
  ]);
}
