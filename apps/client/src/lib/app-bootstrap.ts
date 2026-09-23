import { ORPCError } from "@orpc/client";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { orpcQuery } from "@/lib/orpc";
import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

export function appBootstrapQueryOptions() {
  return orpcQuery.app.bootstrap.queryOptions();
}

export function ensureAppBootstrap(queryClient: QueryClient) {
  return queryClient.ensureQueryData(appBootstrapQueryOptions());
}

/** Bootstrap for a page that requires sign-in; an expired session redirects to login and back. */
export async function ensureSignedInBootstrap(queryClient: QueryClient, returnTo: string) {
  try {
    return await ensureAppBootstrap(queryClient);
  } catch (error) {
    if (isUnauthorizedBootstrapError(error)) {
      throw redirect({ to: "/login", search: { redirect: returnTo }, replace: true });
    }
    throw error;
  }
}

/** The signed-in workspace; `_app` resolves it before any child route loads. */
export async function ensureWorkspace(queryClient: QueryClient) {
  const bootstrap = await ensureAppBootstrap(queryClient);
  if (!bootstrap.workspace) throw new Error("Workspace bootstrap is required");
  return bootstrap.workspace;
}

/** Whether the viewer has `capability` in the current workspace; false until bootstrap loads. */
export function useWorkspaceCapability(capability: keyof WorkspaceCapabilities): boolean {
  const { data } = useQuery(appBootstrapQueryOptions());
  return data?.workspace?.capabilities[capability] ?? false;
}

export function isUnauthorizedBootstrapError(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED" && error.status === 401;
}
