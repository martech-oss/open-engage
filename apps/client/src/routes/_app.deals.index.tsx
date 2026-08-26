import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  dealOptionsQueryOptions,
  dealSearchDefaults,
  dealsQueryOptions,
  type DealSearch,
  parseDealSearch,
} from "@/features/deals/deal-api";
import { DealsPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/deals/")({
  validateSearch: (search: Partial<DealSearch> & SearchSchemaInput): DealSearch =>
    parseDealSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(dealSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(dealOptionsQueryOptions()),
      context.queryClient.ensureQueryData(dealsQueryOptions(deps)),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: DealsRoute,
});

function DealsRoute() {
  return <DealsPage search={Route.useSearch()} />;
}
