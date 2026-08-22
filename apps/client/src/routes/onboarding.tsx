import { ORPCError } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { WorkspaceSetupPage } from "@/features/auth/auth-pages";
import { getCurrentSession } from "@/lib/auth-session";
import { workspaceQueryOptions } from "@/lib/workspace";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context, location }) => {
    const session = await getCurrentSession();
    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
        replace: true,
      });
    }
    try {
      await context.queryClient.ensureQueryData(workspaceQueryOptions());
      throw redirect({ to: "/dashboard", replace: true });
    } catch (error) {
      if (error instanceof ORPCError && error.defined && error.code === "WORKSPACE_REQUIRED") {
        return;
      }
      throw error;
    }
  },
  pendingComponent: () => <RoutePending label="ワークスペースを確認しています…" />,
  errorComponent: RouteError,
  component: WorkspaceSetupPage,
});
