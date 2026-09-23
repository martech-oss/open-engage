import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { CompaniesListPage } from "@/features/companies/companies-list-page";
import {
  companiesQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  companySearchDefaults,
  type CompanySearch,
  parseCompanySearch,
} from "@/features/companies/company-api";

export const Route = createFileRoute("/_app/companies/")({
  validateSearch: (search: Partial<CompanySearch> & SearchSchemaInput): CompanySearch =>
    parseCompanySearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(companySearchDefaults)],
  },
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(companiesQueryOptions(deps.q)),
      context.queryClient.ensureQueryData(companyEnrichmentCapabilityQueryOptions()),
    ]);
    return undefined;
  },
  component: CompaniesRoute,
});

function CompaniesRoute() {
  const { q } = Route.useSearch();
  return <CompaniesListPage query={q} />;
}
