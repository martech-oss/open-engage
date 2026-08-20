import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { WorkspaceRole } from "@openengage/core/shared";

import {
  type Asset,
  type AssetSearch,
  type AssetSummary,
  type AssetVisibility,
  assetsQueryOptions,
  invalidateAssetsList,
  loadAsset,
  useArchiveAsset,
  useDeleteAsset,
  useRestoreAsset,
  useUpdateAsset,
} from "../asset-api";
import { assetPermissions } from "./permissions";
import type { AssetActionHandlers } from "./types";

export function useAssetsPageController(initialSearch: AssetSearch, role: WorkspaceRole) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite, canDelete } = assetPermissions(role);
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

  async function openEditor(
    asset: AssetSummary,
    set: (value: Asset | null) => void,
  ): Promise<void> {
    try {
      set(await loadAsset(asset.id));
    } catch (error) {
      toast.error(getErrorMessage(error, "アセットを読み込めませんでした"));
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

  async function finishUpload(count: number): Promise<void> {
    setUploadOpen(false);
    await refresh();
    toast.success(`${count}件のアセットをアップロードしました`);
  }

  async function finishReplacement(): Promise<void> {
    setReplacing(null);
    await refresh();
    toast.success("ファイルを差し替えました");
  }

  const actionHandlers: AssetActionHandlers = {
    onEdit: (asset) => void openEditor(asset, setEditing),
    onReplace: (asset) => void openEditor(asset, setReplacing),
    onRestore: (asset) =>
      void withToast(async () => {
        await restoreAsset.mutateAsync({ id: asset.id });
      }, "アセットを復元しました"),
    onArchive: (asset) =>
      withToast(async () => {
        await archiveAsset.mutateAsync({ id: asset.id });
      }, "アセットをアーカイブしました"),
    onDelete: (asset) =>
      withToast(async () => {
        await deleteAsset.mutateAsync({ id: asset.id });
      }, "アセットを削除しました"),
  };

  return {
    canWrite,
    canDelete,
    queryText,
    setQueryText,
    setSearch,
    items,
    total,
    loading: assetsQuery.isFetching,
    pagination: {
      hasNextPage: Boolean(nextCursor),
      hasPreviousPage,
      onNext: () => goToNextPage(nextCursor),
      onPrevious: goToPreviousPage,
    },
    actionHandlers,
    uploadOpen,
    setUploadOpen,
    editing,
    setEditing,
    replacing,
    setReplacing,
    saveEdit,
    finishUpload,
    finishReplacement,
    refresh,
  };
}
