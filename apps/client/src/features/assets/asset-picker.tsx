import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ImagesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  type AssetSummary,
  formatBytes,
  publicImageAssetsQueryOptions,
} from "@/features/assets/asset-api";
import { AssetThumbnail } from "@/features/assets/asset-bits";

/**
 * Picks a *public* image to embed. Private assets are excluded on purpose:
 * their `publicUrl` is null, and the content document's `image.src` is a
 * `z.url()` that would reject an empty string anyway.
 */
export function AssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: AssetSummary) => void;
}): ReactNode {
  const assetsQuery = useQuery({
    ...publicImageAssetsQueryOptions(),
    enabled: open,
  });
  const items = (assetsQuery.data?.items ?? []).filter((asset) => asset.publicUrl !== null);

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="アセットから画像を選択"
      description="公開設定になっている画像のみ埋め込めます。"
      className="sm:max-w-2xl"
    >
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={ImagesIcon}
          title="公開されている画像がありません"
          description="画像を公開すると、ここからコンテンツへ埋め込めます。"
          action={
            <Button variant="outline" render={<Link to="/website/assets" />} nativeButton={false}>
              アセットライブラリを開く
            </Button>
          }
        />
      ) : (
        <ItemGroup className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-3">
          {items.map((asset) => (
            <Item
              key={asset.id}
              render={
                <button
                  type="button"
                  aria-label={`${asset.name}を選択`}
                  onClick={() => onSelect(asset)}
                />
              }
              variant="outline"
              className="h-full flex-col items-stretch overflow-hidden p-0 text-left"
            >
              <ItemMedia className="aspect-video w-full overflow-hidden bg-muted">
                <AssetThumbnail asset={asset} />
              </ItemMedia>
              <ItemContent className="w-full px-3 pb-3">
                <ItemTitle>{asset.name}</ItemTitle>
                <ItemDescription>
                  {formatBytes(asset.size)}
                  {asset.width && asset.height ? ` ・ ${asset.width}×${asset.height}` : ""}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
    </AppDialog>
  );
}
