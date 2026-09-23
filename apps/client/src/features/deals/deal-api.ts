import type { QueryClient } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import type {
  DealCreate,
  DealDetailData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskListItem,
  DealTaskStatus,
  DealTaskType,
} from "@openengage/core/deals";

export type {
  DealCreate,
  DealDetailData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskListItem,
  DealTaskStatus,
  DealTaskType,
};

export type DealPipeline = DealOptions["pipelines"][number];

export interface DealSearch {
  pipelineId: string;
  status: DealStatus | "all";
  q: string;
}

export const dealSearchDefaults: DealSearch = {
  pipelineId: "",
  status: "open",
  q: "",
};

function isDealStatus(value: unknown): value is DealSearch["status"] {
  return value === "open" || value === "won" || value === "lost" || value === "all";
}

export function parseDealSearch(search: Record<string, unknown>): DealSearch {
  return {
    pipelineId: typeof search.pipelineId === "string" ? search.pipelineId : "",
    status: isDealStatus(search.status) ? search.status : "open",
    q: typeof search.q === "string" ? search.q : "",
  };
}

export function dealOptionsQueryOptions() {
  return orpcQuery.deals.options.queryOptions();
}

export function dealsQueryOptions(search: DealSearch) {
  return orpcQuery.deals.list.queryOptions({
    input: {
      status: search.status,
      ...(search.pipelineId ? { pipelineId: search.pipelineId } : {}),
      ...(search.q.trim() ? { q: search.q.trim() } : {}),
    },
  });
}

export function dealDetailQueryOptions(dealId: string) {
  return orpcQuery.deals.get.queryOptions({ input: { id: dealId } });
}

export type TaskSearch = { status: DealTaskStatus | "all"; mine?: boolean };

export const taskSearchDefaults: TaskSearch = { status: "open" };

function isTaskStatus(value: unknown): value is TaskSearch["status"] {
  return value === "open" || value === "completed" || value === "all";
}

export function parseTaskSearch(search: Record<string, unknown>): TaskSearch {
  return {
    status: isTaskStatus(search.status) ? search.status : "open",
    mine: search.mine === true || search.mine === "true",
  };
}

export function tasksQueryOptions(search: TaskSearch) {
  return orpcQuery.deals.listTasks.queryOptions({
    input: { status: search.status, ...(search.mine ? { mine: true } : {}) },
  });
}

function invalidateDealQueries(queryClient: QueryClient, dealId?: string) {
  return Promise.all([
    ...(dealId
      ? [
          queryClient.invalidateQueries({
            queryKey: orpcQuery.deals.get.key({ input: { id: dealId } }),
          }),
        ]
      : []),
    queryClient.invalidateQueries({ queryKey: orpcQuery.deals.list.key() }),
    queryClient.invalidateQueries({ queryKey: orpcQuery.deals.listTasks.key() }),
    queryClient.invalidateQueries({ queryKey: orpcQuery.deals.options.key() }),
  ]);
}

export function useCreateDeal() {
  return useInvalidatingMutation(orpcQuery.deals.create.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}

/**
 * onSuccess returns the invalidation promise instead of firing it and
 * forgetting, so the kanban board's busy state clears only after the list
 * has refetched with the deal's new stage — otherwise the move controls
 * would re-enable a beat before the card actually settles into its column.
 */
export function useMoveDeal() {
  return useInvalidatingMutation(orpcQuery.deals.move.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}

export function useUpdateDeal() {
  return useInvalidatingMutation(
    orpcQuery.deals.update.mutationOptions(),
    (queryClient, variables) => invalidateDealQueries(queryClient, variables.id),
  );
}

export function useArchiveDeal() {
  return useInvalidatingMutation(orpcQuery.deals.archive.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}

export function useCreateDealTask() {
  return useInvalidatingMutation(
    orpcQuery.deals.createTask.mutationOptions(),
    (queryClient, variables) => invalidateDealQueries(queryClient, variables.dealId),
  );
}

export function useUpdateDealTask() {
  return useInvalidatingMutation(
    orpcQuery.deals.updateTask.mutationOptions(),
    (queryClient, variables) => invalidateDealQueries(queryClient, variables.dealId),
  );
}

export function useDeleteDealTask() {
  return useInvalidatingMutation(
    orpcQuery.deals.deleteTask.mutationOptions(),
    (queryClient, variables) => invalidateDealQueries(queryClient, variables.dealId),
  );
}

export function useCreateDealPipeline() {
  return useInvalidatingMutation(orpcQuery.deals.createPipeline.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}

export function useUpdateDealPipeline() {
  return useInvalidatingMutation(orpcQuery.deals.updatePipeline.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}

export function useArchiveDealPipeline() {
  return useInvalidatingMutation(orpcQuery.deals.archivePipeline.mutationOptions(), (queryClient) =>
    invalidateDealQueries(queryClient),
  );
}
