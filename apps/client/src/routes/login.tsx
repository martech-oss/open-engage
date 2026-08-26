import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { AuthPage } from "@/features/auth/auth-pages";
import { ensureAppBootstrap, isUnauthorizedBootstrapError } from "@/lib/app-bootstrap";
import { safeRedirectTarget } from "@/lib/auth-session";

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: safeRedirectTarget(search.redirect),
  }),
  beforeLoad: async ({ context }) => {
    try {
      await ensureAppBootstrap(context.queryClient);
      throw redirect({ to: "/dashboard", replace: true });
    } catch (error) {
      if (!isUnauthorizedBootstrapError(error)) throw error;
    }
    return undefined;
  },
  pendingComponent: () => <RoutePending label="認証状態を確認しています…" />,
  errorComponent: RouteError,
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  return <AuthPage redirectTo={redirectTo} />;
}
