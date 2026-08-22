import type { ReactNode } from "react";

import type { DataTableColumn } from "@/components/data-table";

import { formatBytes, type AssetSummary } from "../asset-api";
import { AssetKindBadge, AssetThumbnail, AssetVisibilityBadge } from "../asset-bits";

export function createAssetColumns(
  renderActions: (asset: AssetSummary) => ReactNode,
  formatDateTime: (value: string) => string,
): DataTableColumn<AssetSummary>[] {
  return [
    {
      key: "name",
      header: "名前",
      cell: (asset) => (
        <div className="flex items-center gap-3">
          <div className="size-10 shrink-0 overflow-hidden rounded-md border">
            <AssetThumbnail asset={asset} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{asset.name}</span>
            <span className="truncate text-xs text-muted-foreground">{asset.originalFilename}</span>
          </div>
        </div>
      ),
    },
    { key: "kind", header: "種別", cell: (asset) => <AssetKindBadge kind={asset.kind} /> },
    {
      key: "size",
      header: "サイズ",
      cell: (asset) => (
        <span className="text-sm text-muted-foreground">
          {formatBytes(asset.size)}
          {asset.width && asset.height ? ` ・ ${asset.width}×${asset.height}` : ""}
        </span>
      ),
    },
    {
      key: "visibility",
      header: "公開",
      cell: (asset) => (
        <AssetVisibilityBadge visibility={asset.visibility} archived={asset.archivedAt !== null} />
      ),
    },
    { key: "createdAt", header: "作成日", cell: (asset) => formatDateTime(asset.createdAt) },
    { key: "actions", header: "操作", cell: renderActions, headClassName: "text-right" },
  ];
}
