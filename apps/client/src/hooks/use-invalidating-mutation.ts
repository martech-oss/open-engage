import {
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { invalidateQueryRoots } from "@/lib/query-invalidation";

/** Query roots to refresh, or a function that refreshes whatever a success changed. */
export type MutationInvalidation<TData, TVariables> =
  | readonly QueryKey[]
  | ((queryClient: QueryClient, variables: TVariables, data: TData) => Promise<unknown>);

/**
 * A mutation that refreshes the reads it changed once it succeeds. The
 * invalidation is awaited, so `mutateAsync` resolves after affected queries
 * refetched and callers can navigate or close dialogs on fresh data.
 */
export function useInvalidatingMutation<TData, TError, TVariables, TOnMutateResult>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
  invalidates: MutationInvalidation<TData, TVariables>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    onSuccess: async (data, variables, onMutateResult, context) => {
      await (typeof invalidates === "function"
        ? invalidates(queryClient, variables, data)
        : invalidateQueryRoots(queryClient, ...invalidates));
      await options.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}
