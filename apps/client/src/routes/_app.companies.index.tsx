import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { CompaniesPage } from "@/features/companies/companies-page";
import {
  companiesQueryOptions,
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
  loader: ({ deps, context }) => context.queryClient.ensureQueryData(companiesQueryOptions(deps.q)),
  ...routeStatusComponents,
  component: CompaniesRoute,
});

function CompaniesRoute() {
  const { q } = Route.useSearch();
  return <CompaniesPage initialQuery={q} />;
}
