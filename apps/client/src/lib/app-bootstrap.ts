import { ORPCError } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

export function appBootstrapQueryOptions() {
  return orpcQuery.app.bootstrap.queryOptions();
}

export function ensureAppBootstrap(queryClient: QueryClient) {
  return queryClient.ensureQueryData(appBootstrapQueryOptions());
}

export function isUnauthorizedBootstrapError(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED" && error.status === 401;
}
