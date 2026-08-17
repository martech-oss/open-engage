import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskListItem,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
} from "@openengage/core/deals";

export type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskListItem,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
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

export type TaskSearch = { status: DealTaskStatus | "all" };

export const taskSearchDefaults: TaskSearch = { status: "open" };

function isTaskStatus(value: unknown): value is TaskSearch["status"] {
  return value === "open" || value === "completed" || value === "all";
}

export function parseTaskSearch(search: Record<string, unknown>): TaskSearch {
  return { status: isTaskStatus(search.status) ? search.status : "open" };
}

export function tasksQueryOptions(search: TaskSearch) {
  return orpcQuery.deals.listTasks.queryOptions({ input: { status: search.status } });
}

function invalidateDealQueries(queryClient: ReturnType<typeof useQueryClient>, dealId?: string) {
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
  ]);
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.create.mutationOptions(),
    onSuccess: () => invalidateDealQueries(queryClient),
  });
}

/**
 * onSuccess returns the invalidation promise instead of firing it and
 * forgetting, so the kanban board's busy state clears only after the list
 * has refetched with the deal's new stage — otherwise the move controls
 * would re-enable a beat before the card actually settles into its column.
 */
export function useMoveDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.move.mutationOptions(),
    onSuccess: () => invalidateDealQueries(queryClient),
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.update.mutationOptions(),
    onSuccess: (_data, variables) => invalidateDealQueries(queryClient, variables.id),
  });
}

export function useArchiveDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.archive.mutationOptions(),
    onSuccess: () => invalidateDealQueries(queryClient),
  });
}

export function useCreateDealTask() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.createTask.mutationOptions(),
    onSuccess: (_data, variables) => invalidateDealQueries(queryClient, variables.dealId),
  });
}

export function useUpdateDealTask() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.updateTask.mutationOptions(),
    onSuccess: (_data, variables) => invalidateDealQueries(queryClient, variables.dealId),
  });
}

export function useDeleteDealTask() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.deals.deleteTask.mutationOptions(),
    onSuccess: (_data, variables) => invalidateDealQueries(queryClient, variables.dealId),
  });
}
