import { useMutation, useQueryClient } from "@tanstack/react-query";

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
function useVariableInvalidator() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: orpcQuery.projects.variablesList.key() }),
      client.invalidateQueries({ queryKey: orpcQuery.projects.variablesUses.key() }),
    ]);
}
export function useSaveVariable() {
  return useMutation({
    ...orpcQuery.projects.variablesSave.mutationOptions(),
    onSuccess: useVariableInvalidator(),
  });
}
export function useDeleteVariable() {
  return useMutation({
    ...orpcQuery.projects.variablesDelete.mutationOptions(),
    onSuccess: useVariableInvalidator(),
  });
}
export function usePreviewVariableImpact() {
  return useMutation(orpcQuery.projects.variablesImpact.mutationOptions());
}
