import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArchiveRestore, Pencil, Replace, Search, Upload, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ArchiveConfirm, CopyButton, PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ASSET_KIND_LABELS,
  type Asset,
  type AssetKind,
  assetRawUrl,
  type AssetSearch,
  type AssetStatusFilter,
  type AssetSummary,
  type AssetView,
  type AssetVisibility,
  assetsQueryOptions,
  formatBytes,
  invalidateAssetsList,
  loadAsset,
  useArchiveAsset,
  useDeleteAsset,
  useRestoreAsset,
  useUpdateAsset,
} from "@/features/assets/asset-api";
import { AssetKindBadge, AssetThumbnail, AssetVisibilityBadge } from "@/features/assets/asset-bits";
import {
  AssetDeleteConfirm,
  AssetEditDialog,
  AssetReplaceDialog,
  AssetUploadDialog,
} from "@/features/assets/asset-forms";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";
import type { WorkspaceRole } from "@openengage/core/shared";

const WRITE_ROLES = new Set<WorkspaceRole>(["marketer", "admin", "owner"]);
const DELETE_ROLES = new Set<WorkspaceRole>(["admin", "owner"]);

export function AssetsPage({
  initialSearch,
  role,
}: {
  initialSearch: AssetSearch;
  role: WorkspaceRole;
}): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = WRITE_ROLES.has(role);
  const canDelete = DELETE_ROLES.has(role);
  const paginationKey = JSON.stringify([
    initialSearch.q,
    initialSearch.kind,
    initialSearch.status,
    initialSearch.view,
  ]);

  const { cursor, hasPreviousPage, goToNextPage, goToPreviousPage } =
    useCursorPagination(paginationKey);

  const [queryText, setQueryText] = useState(initialSearch.q);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [replacing, setReplacing] = useState<Asset | null>(null);

  const assetsQuery = useQuery(assetsQueryOptions(initialSearch, cursor));
  const items = assetsQuery.data?.items ?? [];
  const total = assetsQuery.data?.total ?? 0;
  const nextCursor = assetsQuery.data?.nextCursor;

  const updateAsset = useUpdateAsset();
  const archiveAsset = useArchiveAsset();
  const restoreAsset = useRestoreAsset();
  const deleteAsset = useDeleteAsset();

  useDebouncedSearch({
    value: queryText,
    onCommit: (value) => {
      if (value === initialSearch.q) return;
      void navigate({
        to: "/website/assets",
        search: { ...initialSearch, q: value },
        replace: true,
      });
    },
  });

  function setSearch(changes: Partial<AssetSearch>): void {
    void navigate({
      to: "/website/assets",
      search: { ...initialSearch, ...changes },
      replace: true,
    });
  }

  async function refresh(): Promise<void> {
    await invalidateAssetsList(queryClient);
  }

  async function withToast(action: () => Promise<void>, message: string): Promise<void> {
    try {
      await action();
      toast.success(message);
    } catch (error) {
      toast.error(getErrorMessage(error, "操作に失敗しました"));
    }
  }

  async function saveEdit(values: {
    name: string;
    description: string;
    altText: string;
    visibility: AssetVisibility;
  }): Promise<void> {
    if (!editing) return;
    await updateAsset.mutateAsync({ id: editing.id, ...values });
    setEditing(null);
    toast.success("アセットを更新しました");
  }

  const actions = (asset: AssetSummary): ReactNode => (
    <div className="flex flex-wrap justify-end gap-1">
      {asset.publicUrl ? <CopyButton value={asset.publicUrl} label="URL" /> : null}
      <Button
        size="sm"
        variant="outline"
        render={
          <a
            href={assetRawUrl(asset.id)}
            download={asset.originalFilename}
            aria-label={`${asset.name}をダウンロード`}
          />
        }
      >
        取得
      </Button>
      {canWrite ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${asset.name}を編集`}
            onClick={() => void openEditor(asset, setEditing)}
          >
            <Pencil />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${asset.name}を差し替え`}
            onClick={() => void openEditor(asset, setReplacing)}
          >
            <Replace />
          </Button>
          {asset.archivedAt ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${asset.name}を復元`}
              onClick={() =>
                void withToast(async () => {
                  await restoreAsset.mutateAsync({ id: asset.id });
                }, "アセットを復元しました")
              }
            >
              <ArchiveRestore />
            </Button>
          ) : (
            <ArchiveConfirm
              label={asset.name}
              description={`「${asset.name}」は通常の一覧から非表示になり、公開URLは404になります。ファイル自体は残ります。`}
              onConfirm={() =>
                withToast(async () => {
                  await archiveAsset.mutateAsync({ id: asset.id });
                }, "アセットをアーカイブしました")
              }
            />
          )}
        </>
      ) : null}
      {canDelete ? (
        <AssetDeleteConfirm
          name={asset.name}
          onConfirm={() =>
            withToast(async () => {
              await deleteAsset.mutateAsync({ id: asset.id });
            }, "アセットを削除しました")
          }
        />
      ) : null}
    </div>
  );

  const columns: DataTableColumn<AssetSummary>[] = [
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
    { key: "actions", header: "操作", cell: actions, headClassName: "text-right" },
  ];

  const pagination = {
    hasNextPage: Boolean(nextCursor),
    hasPreviousPage,
    onNext: () => goToNextPage(nextCursor),
    onPrevious: goToPreviousPage,
  };

  return (
    <PageLayout
      title="アセット"
      action={
        canWrite ? (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            アップロード
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-sm flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={queryText}
            onChange={(event) => setQueryText(event.currentTarget.value)}
            placeholder="名前で検索"
            aria-label="アセットを検索"
          />
          {queryText ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={() => setQueryText("")} aria-label="検索条件をクリア">
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <NativeSelect
          value={initialSearch.kind}
          onChange={(event) => setSearch({ kind: event.currentTarget.value as AssetKind | "" })}
          aria-label="種別で絞り込む"
          className="w-40"
        >
          <NativeSelectOption value="">すべての種別</NativeSelectOption>
          {(Object.keys(ASSET_KIND_LABELS) as AssetKind[]).map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {ASSET_KIND_LABELS[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ToggleGroup
          value={[initialSearch.status]}
          onValueChange={(value) => {
            const next = value[0] as AssetStatusFilter | undefined;
            if (next) setSearch({ status: next });
          }}
          aria-label="表示する状態"
        >
          <ToggleGroupItem value="active">有効</ToggleGroupItem>
          <ToggleGroupItem value="archived">アーカイブ</ToggleGroupItem>
          <ToggleGroupItem value="all">すべて</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          value={[initialSearch.view]}
          onValueChange={(value) => {
            const next = value[0] as AssetView | undefined;
            if (next) setSearch({ view: next });
          }}
          aria-label="表示形式"
        >
          <ToggleGroupItem value="grid">ギャラリー</ToggleGroupItem>
          <ToggleGroupItem value="table">テーブル</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {initialSearch.view === "table" ? (
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
              loading={assetsQuery.isFetching}
              emptyTitle="アセットがありません"
              emptyDescription="画像やeBook、スライドをアップロードして共有できます。"
              pagination={pagination}
            />
          </CardContent>
        </Card>
      ) : (
        <AssetGallery
          items={items}
          total={total}
          loading={assetsQuery.isFetching}
          pagination={pagination}
          renderActions={actions}
        />
      )}

      {canWrite ? (
        <AssetUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={async (count) => {
            setUploadOpen(false);
            await refresh();
            toast.success(`${count}件のアセットをアップロードしました`);
          }}
        />
      ) : null}
      {editing ? (
        <AssetEditDialog
          key={editing.id}
          asset={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSubmit={saveEdit}
        />
      ) : null}
      {replacing ? (
        <AssetReplaceDialog
          key={replacing.id}
          asset={replacing}
          open
          onOpenChange={(open) => {
            if (!open) setReplacing(null);
          }}
          onReplaced={async () => {
            setReplacing(null);
            await refresh();
            toast.success("ファイルを差し替えました");
          }}
        />
      ) : null}
    </PageLayout>
  );
}

function AssetGallery({
  items,
  total,
  loading,
  pagination,
  renderActions,
}: {
  items: AssetSummary[];
  total: number;
  loading: boolean;
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    onNext: () => void;
    onPrevious: () => void;
  };
  renderActions: (asset: AssetSummary) => ReactNode;
}): ReactNode {
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

/**
 * The list returns summaries; the edit and replace dialogs need the full record
 * (description, altText). Widening the summary would ship those fields to every
 * gallery tile for no reason, so they are fetched on demand instead.
 */
async function openEditor(asset: AssetSummary, set: (value: Asset | null) => void): Promise<void> {
  try {
    set(await loadAsset(asset.id));
  } catch (error) {
    toast.error(getErrorMessage(error, "アセットを読み込めませんでした"));
  }
}
