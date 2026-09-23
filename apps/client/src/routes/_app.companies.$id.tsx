import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  companyEnrichmentCapabilityQueryOptions,
  companyQueryOptions,
} from "@/features/companies/company-api";
import { CompanyDetailPage } from "@/features/companies/company-detail-page";

export const Route = createFileRoute("/_app/companies/$id")({
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(companyQueryOptions(params.id)),
      context.queryClient.ensureQueryData(companyEnrichmentCapabilityQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: CompanyDetailRoute,
});

function CompanyDetailRoute() {
  const { id } = Route.useParams();
  return <CompanyDetailPage companyId={id} />;
}
