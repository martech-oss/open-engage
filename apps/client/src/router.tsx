import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { RouteError, RoutePending } from "@/components/route-status";
import { createQueryClient } from "@/lib/query-client";

import { routeTree } from "./routeTree.gen";

/** Router behavior shared by the app and the preview harness. */
export const routerOptions = {
  defaultPreload: "intent",
  defaultPreloadDelay: 80,
  defaultPendingMs: 300,
  defaultPendingMinMs: 200,
  defaultPendingComponent: () => <RoutePending />,
  defaultErrorComponent: RouteError,
  defaultStructuralSharing: true,
  search: { strict: true },
  scrollRestoration: true,
} as const;

export function getRouter() {
  const queryClient = createQueryClient();
  const router = createRouter({ ...routerOptions, routeTree, context: { queryClient } });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
