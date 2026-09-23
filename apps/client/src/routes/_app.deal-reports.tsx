import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";

import { DealReportsPage } from "@/features/deals/deal-pages/deal-reports-page";
import {
  createReportSearchDefaults,
  dealReportQueryOptions,
  parseDealReportSearch,
  type DealReportSearch,
} from "@/features/reports/report-api";
import { ensureAppBootstrap } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/deal-reports")({
  validateSearch: (search: Partial<DealReportSearch> & SearchSchemaInput): DealReportSearch =>
    parseDealReportSearch(search as Record<string, unknown>, {
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
    return {
      dealReportSearch: parseDealReportSearch(search, defaults),
    };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(dealReportQueryOptions(context.dealReportSearch));
    return undefined;
  },
  component: DealReportsRoute,
});

function DealReportsRoute() {
  return <DealReportsPage search={Route.useRouteContext().dealReportSearch} />;
}
