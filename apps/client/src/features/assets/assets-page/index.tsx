import { Upload } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import type { WorkspaceRole } from "@openengage/core/shared";

import type { AssetSearch, AssetSummary } from "../asset-api";
import { AssetActions } from "./actions";
import { createAssetColumns } from "./columns";
import { useAssetsPageController } from "./controller";
import { AssetDialogs } from "./dialogs";
import { AssetsToolbar } from "./toolbar";
import { AssetCollectionView } from "./view";

export function AssetsPage({
  initialSearch,
  role,
}: {
  initialSearch: AssetSearch;
  role: WorkspaceRole;
}): ReactNode {
  const controller = useAssetsPageController(initialSearch, role);
  const renderActions = (asset: AssetSummary): ReactNode => (
    <AssetActions
      asset={asset}
      canWrite={controller.canWrite}
      canDelete={controller.canDelete}
      handlers={controller.actionHandlers}
    />
  );
  const columns = createAssetColumns(renderActions);
  return (
    <PageLayout
      title="アセット"
      action={
        controller.canWrite ? (
          <Button onClick={() => controller.setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            アップロード
          </Button>
        ) : undefined
      }
    >
      <AssetsToolbar
        search={initialSearch}
        queryText={controller.queryText}
        onQueryTextChange={controller.setQueryText}
        onSearchChange={controller.setSearch}
      />
      <AssetCollectionView
        view={initialSearch.view}
        items={controller.items}
        total={controller.total}
        loading={controller.loading}
        pagination={controller.pagination}
        columns={columns}
        renderActions={renderActions}
      />
      <AssetDialogs
        canWrite={controller.canWrite}
        uploadOpen={controller.uploadOpen}
        onUploadOpenChange={controller.setUploadOpen}
        onUploaded={controller.finishUpload}
        editing={controller.editing}
        onEditingChange={controller.setEditing}
        onSaveEdit={controller.saveEdit}
        replacing={controller.replacing}
        onReplacingChange={controller.setReplacing}
        onReplaced={controller.finishReplacement}
      />
    </PageLayout>
  );
}
