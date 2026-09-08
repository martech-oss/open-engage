import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
export const campaignCostsQueryOptions = (id: string) =>
  orpcQuery.projects.listCosts.queryOptions({ input: { id }, enabled: Boolean(id) });
function useCostInvalidation() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: orpcQuery.projects.key() }),
      client.invalidateQueries({ queryKey: orpcQuery.reports.key() }),
    ]);
}
export function useCreateCampaignCost() {
  return useMutation(
    orpcQuery.projects.createCost.mutationOptions({ onSuccess: useCostInvalidation() }),
  );
}
export function useUpdateCampaignCost() {
  return useMutation(
    orpcQuery.projects.updateCost.mutationOptions({ onSuccess: useCostInvalidation() }),
  );
}
export function useDeleteCampaignCost() {
  return useMutation(
    orpcQuery.projects.deleteCost.mutationOptions({ onSuccess: useCostInvalidation() }),
  );
}
