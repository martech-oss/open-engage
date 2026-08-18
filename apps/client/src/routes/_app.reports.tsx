import {
  createFileRoute,
  redirect,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  parseReportSearch,
  reportSearchDefaults,
  reportWorkspaceQueryOptions,
  type ReportSearch,
} from "@/features/reports/report-api";
import { ReportsPage } from "@/features/reports/report-pages";

export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Partial<ReportSearch> & SearchSchemaInput): ReportSearch =>
    parseReportSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(reportSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (deps.view === "deals") {
      throw redirect({
        to: "/deal-reports",
        search: { from: deps.from, to: deps.to, currency: deps.currency },
      });
    }
    await context.queryClient.ensureQueryData(reportWorkspaceQueryOptions(deps));
  },
  ...routeStatusComponents,
  component: ReportsRoute,
});

function ReportsRoute() {
  return <ReportsPage search={Route.useSearch()} />;
}
