import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import type { OrpcContext } from "../orpc/context";
import {
  AssetContentTypeBlockedError,
  archiveAsset,
  deleteAsset,
  getAsset,
  getAssetFile,
  listAssets,
  loadAssetOrigin,
  restoreAsset,
  updateAsset,
  uploadAsset,
} from "./service";

function resolveAssetOrigin(context: OrpcContext) {
  return loadAssetOrigin(context.database, context.workspace.workspaceId, context.env.APP_URL);
}

export const listAssetsProcedure = authed.assets.list.handler(async ({ context, input }) => {
  const origin = await resolveAssetOrigin(context);
  return listAssets(context.database, context.workspace.workspaceId, input, origin);
});

export const getAssetProcedure = authed.assets.get.handler(async ({ context, input, errors }) => {
  const origin = await resolveAssetOrigin(context);
  const asset = await getAsset(context.database, context.workspace.workspaceId, input.id, origin);
  if (!asset) throw errors.ASSET_NOT_FOUND();
  return asset;
});

export const uploadAssetProcedure = authed.assets.upload.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const origin = await resolveAssetOrigin(context);
    const body = await input.file.arrayBuffer();
    try {
      return await uploadAsset(
        context.database,
        context.env.ASSETS_BUCKET,
        context.workspace,
        {
          name: input.name,
          body,
          contentType: input.file.type || "application/octet-stream",
          visibility: input.visibility,
        },
        origin,
        context.executionContext,
      );
    } catch (error) {
      if (error instanceof AssetContentTypeBlockedError) {
        throw errors.ASSET_CONTENT_TYPE_BLOCKED();
      }
      throw error;
    }
  },
);

export const downloadAssetProcedure = authed.assets.download.handler(
  async ({ context, input, errors }) => {
    const file = await getAssetFile(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace.workspaceId,
      input.id,
    );
    if (!file) throw errors.ASSET_NOT_FOUND();
    return file;
  },
);

export const updateAssetProcedure = authed.assets.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const origin = await resolveAssetOrigin(context);
    const outcome = await updateAsset(
      context.database,
      context.workspace,
      input,
      origin,
      context.executionContext,
    );
    if (outcome.kind === "not_found") throw errors.ASSET_NOT_FOUND();
    if (outcome.kind === "archived") throw errors.ASSET_ARCHIVED();
    return outcome.asset;
  },
);

export const archiveAssetProcedure = authed.assets.archive.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const archived = await archiveAsset(
      context.database,
      context.workspace,
      input.id,
      context.executionContext,
    );
    if (!archived) throw errors.ASSET_NOT_FOUND();
    return ack;
  },
);

export const restoreAssetProcedure = authed.assets.restore.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const restored = await restoreAsset(
      context.database,
      context.workspace,
      input.id,
      context.executionContext,
    );
    if (!restored) throw errors.ASSET_NOT_ARCHIVED();
    return ack;
  },
);

export const deleteAssetProcedure = authed.assets.delete.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const deleted = await deleteAsset(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace,
      input.id,
      context.executionContext,
    );
    if (!deleted) throw errors.ASSET_NOT_FOUND();
    return ack;
  },
);

export const assetProcedures = {
  list: listAssetsProcedure,
  get: getAssetProcedure,
  upload: uploadAssetProcedure,
  download: downloadAssetProcedure,
  update: updateAssetProcedure,
  archive: archiveAssetProcedure,
  restore: restoreAssetProcedure,
  delete: deleteAssetProcedure,
};
