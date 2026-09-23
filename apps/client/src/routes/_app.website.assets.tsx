import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import {
  type AssetSearch,
  assetSearchDefaults,
  assetsQueryOptions,
  parseAssetSearch,
} from "@/features/assets/asset-api";
import { AssetsPage } from "@/features/assets/assets-page";
import { ensureWorkspace } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/website/assets")({
  validateSearch: (search: Partial<AssetSearch> & SearchSchemaInput): AssetSearch =>
    parseAssetSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(assetSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const [, workspace] = await Promise.all([
      context.queryClient.ensureQueryData(assetsQueryOptions(deps)),
      ensureWorkspace(context.queryClient),
    ]);
    return { capabilities: workspace.capabilities };
  },
  component: AssetsRoute,
});

function AssetsRoute() {
  const search = Route.useSearch();
  const { capabilities } = Route.useLoaderData();
  return <AssetsPage initialSearch={search} capabilities={capabilities} />;
}
