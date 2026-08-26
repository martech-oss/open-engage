import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { WorkspaceSetupPage } from "@/features/auth/auth-pages";
import { ensureAppBootstrap, isUnauthorizedBootstrapError } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context, location }) => {
    try {
      const bootstrap = await ensureAppBootstrap(context.queryClient);
      if (bootstrap.workspace) throw redirect({ to: "/dashboard", replace: true });
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
  pendingComponent: () => <RoutePending label="ワークスペースを確認しています…" />,
  errorComponent: RouteError,
  component: WorkspaceSetupPage,
});
