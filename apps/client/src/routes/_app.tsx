import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { AppShell } from "@/layouts/app-shell";
import {
  appBootstrapQueryOptions,
  ensureAppBootstrap,
  isUnauthorizedBootstrapError,
} from "@/lib/app-bootstrap";
import { WorkspaceTimeProvider } from "@/lib/workspace-time";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      const bootstrap = await ensureAppBootstrap(context.queryClient);
      if (!bootstrap.workspace) throw redirect({ to: "/onboarding", replace: true });
    } catch (error) {
      if (isUnauthorizedBootstrapError(error)) {
        throw redirect({
          to: "/login",
          search: { redirect: location.href },
          replace: true,
        });
      }
      throw error;
    }
    return undefined;
  },
  pendingComponent: () => <RoutePending label="ワークスペースを読み込んでいます…" />,
  errorComponent: RouteError,
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { renderedAt } = Route.useRouteContext();
  const { data: bootstrap } = useSuspenseQuery(appBootstrapQueryOptions());
  const { workspace } = bootstrap;
  if (!workspace) return null;
  return (
    <WorkspaceTimeProvider value={{ timeZone: workspace.timezone, renderedAt }}>
      <AppShell user={bootstrap.viewer} workspace={workspace} workspaces={bootstrap.workspaces} />
    </WorkspaceTimeProvider>
  );
}
