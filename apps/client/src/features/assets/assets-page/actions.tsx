import { ArchiveRestore, Pencil, Replace } from "lucide-react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/app-ui";
import { ArchiveConfirm } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";

import { assetRawUrl, type AssetSummary } from "../asset-api";
import { AssetDeleteConfirm } from "../asset-forms";
import type { AssetActionHandlers } from "./types";

export function AssetActions({
  asset,
  canWrite,
  canDelete,
  handlers,
}: {
  asset: AssetSummary;
  canWrite: boolean;
  canDelete: boolean;
  handlers: AssetActionHandlers;
}): ReactNode {
  return (
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
            onClick={() => handlers.onEdit(asset)}
          >
            <Pencil />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${asset.name}を差し替え`}
            onClick={() => handlers.onReplace(asset)}
          >
            <Replace />
          </Button>
          {asset.archivedAt ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${asset.name}を復元`}
              onClick={() => handlers.onRestore(asset)}
            >
              <ArchiveRestore />
            </Button>
          ) : (
            <ArchiveConfirm
              label={asset.name}
              description={`「${asset.name}」は通常の一覧から非表示になり、公開URLは404になります。ファイル自体は残ります。`}
              onConfirm={() => handlers.onArchive(asset)}
            />
          )}
        </>
      ) : null}
      {canDelete ? (
        <AssetDeleteConfirm name={asset.name} onConfirm={() => handlers.onDelete(asset)} />
      ) : null}
    </div>
  );
}
