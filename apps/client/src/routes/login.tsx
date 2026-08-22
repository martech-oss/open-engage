import { createFileRoute, redirect } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { AuthPage } from "@/features/auth/auth-pages";
import { getCurrentSession, safeRedirectTarget } from "@/lib/auth-session";

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: safeRedirectTarget(search.redirect),
  }),
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (session) {
      throw redirect({ to: "/dashboard", replace: true });
    }
  },
  pendingComponent: () => <RoutePending label="認証状態を確認しています…" />,
  errorComponent: RouteError,
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  return <AuthPage redirectTo={redirectTo} />;
}
