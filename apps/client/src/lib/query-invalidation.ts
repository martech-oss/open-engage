import type { QueryClient, QueryKey } from "@tanstack/react-query";

export async function invalidateQueryRoots(
  queryClient: QueryClient,
  ...queryRoots: readonly QueryKey[]
): Promise<void> {
  const uniqueRoots = new Map(queryRoots.map((queryKey) => [JSON.stringify(queryKey), queryKey]));
  await Promise.all(
    [...uniqueRoots.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
