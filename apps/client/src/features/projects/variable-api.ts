import { useMutation } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
export function variablesQueryOptions(projectId: string | null = null) {
  return orpcQuery.projects.variablesList.queryOptions({ input: { projectId } });
}
export function variableUsesQueryOptions(projectId: string | null = null, key?: string) {
  return orpcQuery.projects.variablesUses.queryOptions({
    input: { projectId, ...(key ? { key } : {}) },
  });
}
export function variableProjectsQueryOptions() {
  return orpcQuery.projects.list.queryOptions();
}
export function useSaveVariable() {
  return useInvalidatingMutation(orpcQuery.projects.variablesSave.mutationOptions(), [
    orpcQuery.projects.variablesList.key(),
    orpcQuery.projects.variablesUses.key(),
  ]);
}
export function useDeleteVariable() {
  return useInvalidatingMutation(orpcQuery.projects.variablesDelete.mutationOptions(), [
    orpcQuery.projects.variablesList.key(),
    orpcQuery.projects.variablesUses.key(),
  ]);
}
export function usePreviewVariableImpact() {
  return useMutation(orpcQuery.projects.variablesImpact.mutationOptions());
}
