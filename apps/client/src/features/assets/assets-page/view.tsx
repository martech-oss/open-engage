import type { ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { formatBytes, type AssetSearch, type AssetSummary } from "../asset-api";
import { AssetKindBadge, AssetThumbnail, AssetVisibilityBadge } from "../asset-bits";
import type { AssetPagination } from "./types";

export function AssetCollectionView({
  view,
  items,
  total,
  loading,
  pagination,
  columns,
  renderActions,
}: {
  view: AssetSearch["view"];
  items: AssetSummary[];
  total: number;
  loading: boolean;
  pagination: AssetPagination;
  columns: DataTableColumn<AssetSummary>[];
  renderActions: (asset: AssetSummary) => ReactNode;
}): ReactNode {
  if (view === "table") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>アセット一覧（{total}件）</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(asset) => asset.id}
            caption="アセット一覧"
            loading={loading}
            emptyTitle="アセットがありません"
            emptyDescription="画像やeBook、スライドをアップロードして共有できます。"
            pagination={pagination}
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>アセット一覧（{total}件）</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 && !loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            アセットがありません。画像やeBook、スライドをアップロードして共有できます。
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((asset) => (
              <li key={asset.id} className="flex flex-col overflow-hidden rounded-lg border">
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                  <AssetThumbnail asset={asset} />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <span className="truncate text-sm font-medium" title={asset.name}>
                    {asset.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    <AssetKindBadge kind={asset.kind} />
                    <AssetVisibilityBadge
                      visibility={asset.visibility}
                      archived={asset.archivedAt !== null}
                    />
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatBytes(asset.size)}
                    </span>
                  </div>
                  {renderActions(asset)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!pagination.hasPreviousPage}
            onClick={pagination.onPrevious}
          >
            前へ
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pagination.hasNextPage}
            onClick={pagination.onNext}
          >
            次へ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
