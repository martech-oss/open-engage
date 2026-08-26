import { createFileRoute, redirect, type SearchSchemaInput } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  createReportSearchDefaults,
  parseReportSearch,
  reportWorkspaceQueryOptions,
  type ReportSearch,
} from "@/features/reports/report-api";
import { ReportsPage } from "@/features/reports/report-pages";
import { ensureAppBootstrap } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Partial<ReportSearch> & SearchSchemaInput): ReportSearch =>
    parseReportSearch(search as Record<string, unknown>, {
      view: "overview",
      from: "",
      to: "",
      currency: "",
    }),
  beforeLoad: async ({ context, search }) => {
    const bootstrap = await ensureAppBootstrap(context.queryClient);
    if (!bootstrap.workspace) throw new Error("Workspace bootstrap is required");
    const defaults = createReportSearchDefaults({
      now: context.renderedAt,
      timeZone: bootstrap.workspace.timezone,
    });
    return { reportSearch: parseReportSearch(search, defaults) };
  },
  loader: async ({ context }) => {
    const search = context.reportSearch;
    if (search.view === "deals") {
      throw redirect({
        to: "/deal-reports",
        search: { from: search.from, to: search.to, currency: search.currency },
      });
    }
    await context.queryClient.ensureQueryData(reportWorkspaceQueryOptions(search));
    return undefined;
  },
  ...routeStatusComponents,
  component: ReportsRoute,
});

function ReportsRoute() {
  return <ReportsPage search={Route.useRouteContext().reportSearch} />;
}
