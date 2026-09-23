import { createFileRoute } from "@tanstack/react-router";

import { dashboardQueryOptions } from "@/features/dashboard/dashboard-api";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(dashboardQueryOptions());
    return undefined;
  },
  component: DashboardPage,
});
