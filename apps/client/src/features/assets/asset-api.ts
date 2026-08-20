import {
  type QueryClient,
  keepPreviousData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import { type Asset, type AssetListInput, type AssetSummary } from "@openengage/core/assets";
import type { AssetKind, AssetVisibility } from "@openengage/core/shared";

export type { Asset, AssetKind, AssetSummary, AssetVisibility };

export type AssetStatusFilter = "active" | "archived" | "all";
export type AssetView = "grid" | "table";

export interface AssetSearch {
  q: string;
  kind: AssetKind | "";
  status: AssetStatusFilter;
  view: AssetView;
}

export const assetSearchDefaults: AssetSearch = {
  q: "",
  kind: "",
  // Assets are visual, so the gallery is the more useful default.
  status: "active",
  view: "grid",
};

export const ASSETS_PAGE_SIZE = 50;

const assetKinds = new Set<AssetKind>(["image", "document", "video", "audio", "other"]);
const assetStatuses = new Set<AssetStatusFilter>(["active", "archived", "all"]);

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  image: "画像",
  document: "ドキュメント",
  video: "動画",
  audio: "音声",
  other: "その他",
};

export const ASSET_VISIBILITY_LABELS: Record<AssetVisibility, string> = {
  public: "公開",
  private: "非公開",
};

export function parseAssetSearch(search: Record<string, unknown>): AssetSearch {
  return {
    q: typeof search.q === "string" ? search.q : "",
    kind:
      typeof search.kind === "string" && assetKinds.has(search.kind as AssetKind)
        ? (search.kind as AssetKind)
        : "",
    status:
      typeof search.status === "string" && assetStatuses.has(search.status as AssetStatusFilter)
        ? (search.status as AssetStatusFilter)
        : assetSearchDefaults.status,
    view: search.view === "table" ? "table" : "grid",
  };
}

export function buildAssetListInput(search: AssetSearch, cursor?: string): AssetListInput {
  const query = search.q.trim();
  return {
    limit: ASSETS_PAGE_SIZE,
    status: search.status,
    ...(cursor ? { cursor } : {}),
    ...(query ? { query } : {}),
    ...(search.kind ? { kind: search.kind } : {}),
  };
}

export function assetsQueryOptions(search: AssetSearch, cursor?: string) {
  return orpcQuery.assets.list.queryOptions({
    input: buildAssetListInput(search, cursor),
    placeholderData: keepPreviousData,
  });
}

/** Feeds the embed picker: public images only, since a private `publicUrl` is null. */
export function publicImageAssetsQueryOptions() {
  return orpcQuery.assets.list.queryOptions({
    input: { kind: "image", visibility: "public", status: "active", limit: 60 },
  });
}

export function loadAsset(id: string): Promise<Asset> {
  return orpc.assets.get({ id });
}

export function invalidateAssetsList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: orpcQuery.assets.list.key() });
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.assets.update.mutationOptions(),
    onSuccess: (_data, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpcQuery.assets.get.key({ input: { id: variables.id } }),
        }),
        invalidateAssetsList(queryClient),
      ]),
  });
}

export function useArchiveAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.assets.archive.mutationOptions(),
    onSuccess: () => invalidateAssetsList(queryClient),
  });
}

export function useRestoreAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.assets.restore.mutationOptions(),
    onSuccess: () => invalidateAssetsList(queryClient),
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.assets.delete.mutationOptions(),
    onSuccess: () => invalidateAssetsList(queryClient),
  });
}

/**
 * Same-origin, cookie-authenticated preview. Works for private and archived
 * assets, which the public URL deliberately refuses to serve.
 */
export function assetRawUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}/raw`;
}

/** Public URL when the asset has one, otherwise the authenticated preview. */
export function assetDisplayUrl(asset: Pick<AssetSummary, "id" | "publicUrl">): string {
  return asset.publicUrl ?? assetRawUrl(asset.id);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
