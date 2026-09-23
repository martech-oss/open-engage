import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
export const campaignCostsQueryOptions = (id: string) =>
  orpcQuery.projects.listCosts.queryOptions({ input: { id }, enabled: Boolean(id) });
export function useCreateCampaignCost() {
  return useInvalidatingMutation(orpcQuery.projects.createCost.mutationOptions(), [
    orpcQuery.projects.key(),
    orpcQuery.reports.key(),
  ]);
}
export function useUpdateCampaignCost() {
  return useInvalidatingMutation(orpcQuery.projects.updateCost.mutationOptions(), [
    orpcQuery.projects.key(),
    orpcQuery.reports.key(),
  ]);
}
export function useDeleteCampaignCost() {
  return useInvalidatingMutation(orpcQuery.projects.deleteCost.mutationOptions(), [
    orpcQuery.projects.key(),
    orpcQuery.reports.key(),
  ]);
}
