import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  type AssetSearch,
  assetSearchDefaults,
  assetsQueryOptions,
  parseAssetSearch,
} from "@/features/assets/asset-api";
import { AssetsPage } from "@/features/assets/assets-page";

export const Route = createFileRoute("/_app/website/assets")({
  validateSearch: (search: Partial<AssetSearch> & SearchSchemaInput): AssetSearch =>
    parseAssetSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(assetSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    await context.queryClient.ensureQueryData(assetsQueryOptions(deps));
    return { capabilities: context.workspace.capabilities };
  },
  ...routeStatusComponents,
  component: AssetsRoute,
});

function AssetsRoute() {
  const search = Route.useSearch();
  const { capabilities } = Route.useLoaderData();
  return <AssetsPage initialSearch={search} capabilities={capabilities} />;
}
