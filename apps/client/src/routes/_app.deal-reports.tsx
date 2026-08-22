import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { DealReportsPage } from "@/features/deals/deal-pages";
import {
  createReportSearchDefaults,
  dealReportQueryOptions,
  parseDealReportSearch,
  type DealReportSearch,
} from "@/features/reports/report-api";

export const Route = createFileRoute("/_app/deal-reports")({
  validateSearch: (search: Partial<DealReportSearch> & SearchSchemaInput): DealReportSearch =>
    parseDealReportSearch(search as Record<string, unknown>, {
      from: "",
      to: "",
      currency: "",
    }),
  beforeLoad: ({ context, search }) => {
    const defaults = createReportSearchDefaults({
      now: context.renderedAt,
      timeZone: context.workspace.timezone,
    });
    return {
      dealReportSearch: parseDealReportSearch(search, defaults),
    };
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(dealReportQueryOptions(context.dealReportSearch)),
  ...routeStatusComponents,
  component: DealReportsRoute,
});

function DealReportsRoute() {
  return <DealReportsPage search={Route.useRouteContext().dealReportSearch} />;
}
