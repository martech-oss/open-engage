import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { DealReportsPage } from "@/features/deals/deal-pages";
import {
  dealReportQueryOptions,
  dealReportSearchDefaults,
  parseDealReportSearch,
  type DealReportSearch,
} from "@/features/reports/report-api";

export const Route = createFileRoute("/_app/deal-reports")({
  validateSearch: (search: Partial<DealReportSearch> & SearchSchemaInput): DealReportSearch =>
    parseDealReportSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(dealReportSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps, context }) => context.queryClient.ensureQueryData(dealReportQueryOptions(deps)),
  ...routeStatusComponents,
  component: DealReportsRoute,
});

function DealReportsRoute() {
  return <DealReportsPage search={Route.useSearch()} />;
}
