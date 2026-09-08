import type { LandingPageDocument } from "@openengage/core/web";
import { AssetRepository } from "@openengage/database/assets";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { loadAssetOrigin, toAssetSummary } from "../assets/service";

export async function landingImageUrls(
  database: OpenEngageDatabase,
  workspaceId: string,
  document: LandingPageDocument,
  origin: string,
  preview: boolean,
) {
  const repository = new AssetRepository(database, { workspaceId });
  const assetOrigin = await loadAssetOrigin(database, workspaceId, origin);
  const entries = await Promise.all(
    document.images.map(async (image) => {
      const asset = await repository.getById(image.assetId);
      const url = asset ? toAssetSummary(asset, assetOrigin).publicUrl : null;
      return [
        image.assetId,
        url ?? (preview ? `${origin}/api/email-images/${image.assetId}/preview` : ""),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
