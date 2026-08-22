import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { automationsQueryOptions } from "@/features/automations/automation-api";
import {
  contactTrendQueryOptions,
  dashboardQueryOptions,
  dealSummaryQueryOptions,
  deliveryTrendQueryOptions,
} from "@/features/dashboard/dashboard-api";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  loader: ({ context }) => {
    const clock = { now: context.renderedAt, timeZone: context.workspace.timezone };
    return Promise.all([
      context.queryClient.ensureQueryData(dashboardQueryOptions()),
      context.queryClient.ensureQueryData(deliveryTrendQueryOptions(clock)),
      context.queryClient.ensureQueryData(contactTrendQueryOptions(clock)),
      context.queryClient.ensureQueryData(dealSummaryQueryOptions(clock)),
      context.queryClient.ensureQueryData(automationsQueryOptions()),
    ]);
  },
  ...routeStatusComponents,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { renderedAt, workspace } = Route.useRouteContext();
  return <DashboardPage clock={{ now: renderedAt, timeZone: workspace.timezone }} />;
}
