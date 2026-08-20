import type { ReactNode } from "react";

import type { Asset, AssetVisibility } from "../asset-api";
import { AssetEditDialog, AssetReplaceDialog, AssetUploadDialog } from "../asset-forms";

export function AssetDialogs({
  canWrite,
  uploadOpen,
  onUploadOpenChange,
  onUploaded,
  editing,
  onEditingChange,
  onSaveEdit,
  replacing,
  onReplacingChange,
  onReplaced,
}: {
  canWrite: boolean;
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
  onUploaded: (count: number) => Promise<void>;
  editing: Asset | null;
  onEditingChange: (asset: Asset | null) => void;
  onSaveEdit: (values: {
    name: string;
    description: string;
    altText: string;
    visibility: AssetVisibility;
  }) => Promise<void>;
  replacing: Asset | null;
  onReplacingChange: (asset: Asset | null) => void;
  onReplaced: () => Promise<void>;
}): ReactNode {
  return (
    <>
      {canWrite ? (
        <AssetUploadDialog
          open={uploadOpen}
          onOpenChange={onUploadOpenChange}
          onUploaded={onUploaded}
        />
      ) : null}
      {editing ? (
        <AssetEditDialog
          key={editing.id}
          asset={editing}
          open
          onOpenChange={(open) => {
            if (!open) onEditingChange(null);
          }}
          onSubmit={onSaveEdit}
        />
      ) : null}
      {replacing ? (
        <AssetReplaceDialog
          key={replacing.id}
          asset={replacing}
          open
          onOpenChange={(open) => {
            if (!open) onReplacingChange(null);
          }}
          onReplaced={onReplaced}
        />
      ) : null}
    </>
  );
}
