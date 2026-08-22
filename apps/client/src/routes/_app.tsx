import { ORPCError } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { AppShell } from "@/layouts/app-shell";
import { getCurrentSession } from "@/lib/auth-session";
import { workspaceQueryOptions } from "@/lib/workspace";
import { WorkspaceTimeProvider } from "@/lib/workspace-time";

export const Route = createFileRoute("/_app")({
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
      const workspace = await context.queryClient.ensureQueryData(workspaceQueryOptions());
      return { session, workspace };
    } catch (error) {
      if (error instanceof ORPCError && error.defined && error.code === "WORKSPACE_REQUIRED") {
        throw redirect({ to: "/onboarding", replace: true });
      }
      throw error;
    }
  },
  pendingComponent: () => <RoutePending label="ワークスペースを読み込んでいます…" />,
  errorComponent: RouteError,
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { renderedAt, session, workspace } = Route.useRouteContext();
  return (
    <WorkspaceTimeProvider value={{ timeZone: workspace.timezone, renderedAt }}>
      <AppShell user={session.user} workspace={workspace} />
    </WorkspaceTimeProvider>
  );
}
