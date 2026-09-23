import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { WorkspaceSetupPage } from "@/features/auth/auth-pages";
import { ensureSignedInBootstrap } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context, location }) => {
    const bootstrap = await ensureSignedInBootstrap(context.queryClient, location.href);
    if (bootstrap.workspace) throw redirect({ to: "/dashboard", replace: true });
    return undefined;
  },
  pendingComponent: () => <RoutePending label="ワークスペースを確認しています…" />,
  errorComponent: RouteError,
  component: WorkspaceSetupPage,
});
