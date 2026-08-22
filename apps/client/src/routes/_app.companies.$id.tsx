import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { CompanyDetailPage } from "@/features/companies/companies-page";
import {
  companyContactOptionsQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  companyQueryOptions,
} from "@/features/companies/company-api";

export const Route = createFileRoute("/_app/companies/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(companyQueryOptions(params.id)),
      context.queryClient.ensureQueryData(companyContactOptionsQueryOptions()),
      context.queryClient.ensureQueryData(companyEnrichmentCapabilityQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: CompanyDetailRoute,
});

function CompanyDetailRoute() {
  const { id } = Route.useParams();
  return <CompanyDetailPage companyId={id} />;
}
