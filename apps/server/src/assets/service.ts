import type {
  Asset,
  AssetListInput,
  AssetListResult,
  AssetSummary,
  AssetUpdateInput,
} from "@openengage/core/assets";
import {
  assetKindFromContentType,
  assetPublicPath,
  isBlockedAssetContentType,
  normalizeAssetContentType,
} from "@openengage/core/assets";
import type {
  AssetChecksumAlgorithm,
  AssetKind,
  AssetVisibility,
  WorkspaceContext,
} from "@openengage/core/shared";
import { AssetRepository, type AssetRow } from "@openengage/database/assets";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { writeAuditLog } from "@openengage/database/platform";
import { nowIso, uuidv7 } from "@openengage/database/shared";

import { bytesToHex, sha256HexFromBytes } from "../platform/crypto";
import { sanitizeFilename } from "../platform/values";

/** Raised when an upload's content type is one the delivery routes must never serve. */
export class AssetContentTypeBlockedError extends Error {
  public constructor(contentType: string) {
    super(`Blocked asset content type: ${contentType}`);
    this.name = "AssetContentTypeBlockedError";
  }
}

/** Everything the DTO layer needs beyond the row itself. */
export interface AssetOrigin {
  workspaceSlug: string;
  appUrl: string;
}

export async function loadAssetOrigin(
  database: OpenEngageDatabase,
  workspaceId: string,
  appUrl: string,
): Promise<AssetOrigin> {
  const slug = await new AssetRepository(database, { workspaceId }).workspaceSlug();
  return { workspaceSlug: slug ?? workspaceId, appUrl };
}

/**
 * The `?v=` prefix is the content checksum, so replacing an asset's bytes moves
 * its URL and busts the year-long `immutable` cache the public route sets.
 */
function publicUrlFor(row: AssetRow, origin: AssetOrigin): string | null {
  if (row.visibility !== "public" || row.archivedAt !== null) return null;
  const path = assetPublicPath(origin.workspaceSlug, row.id, row.originalFilename);
  return `${origin.appUrl.replace(/\/$/, "")}${path}?v=${row.checksum.slice(0, 12)}`;
}

export function toAssetSummary(row: AssetRow, origin: AssetOrigin): AssetSummary {
  return {
    id: row.id,
    name: row.name,
    originalFilename: row.originalFilename,
    kind: row.kind as AssetKind,
    contentType: row.contentType,
    size: row.size,
    width: row.width,
    height: row.height,
    visibility: row.visibility as AssetVisibility,
    publicUrl: publicUrlFor(row, origin),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAsset(row: AssetRow, origin: AssetOrigin): Asset {
  return {
    ...toAssetSummary(row, origin),
    description: row.description,
    altText: row.altText,
    checksum: row.checksum,
    checksumAlgorithm: row.checksumAlgorithm as AssetChecksumAlgorithm,
    createdByUserId: row.createdByUserId,
  };
}

export async function listAssets(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: AssetListInput,
  origin: AssetOrigin,
): Promise<AssetListResult> {
  const page = await new AssetRepository(database, { workspaceId }).list(input);
  const items = page.items.map((row) => toAssetSummary(row, origin));
  const last = items.at(-1);
  return {
    items,
    total: page.total,
    ...(page.hasMore && last ? { nextCursor: last.id } : {}),
  };
}

export async function getAsset(
  database: OpenEngageDatabase,
  workspaceId: string,
  assetId: string,
  origin: AssetOrigin,
): Promise<Asset | null> {
  const row = await new AssetRepository(database, { workspaceId }).getById(assetId);
  return row ? toAsset(row, origin) : null;
}

/**
 * The revision segment makes every write land on a fresh key, so a replace can
 * publish new bytes before the old object is removed and never leaves the row
 * pointing at something half-written.
 */
export function buildAssetKey(
  workspaceId: string,
  assetId: string,
  originalFilename: string,
): string {
  const revision = uuidv7().replaceAll("-", "").slice(-12);
  return `${workspaceId}/assets/${assetId}/${revision}-${sanitizeFilename(originalFilename)}`;
}

export interface UploadAssetInput {
  name: string;
  body: ArrayBuffer;
  contentType: string;
  visibility: AssetVisibility;
}

/**
 * Buffered upload path used by the oRPC `upload` procedure. Keeps SHA-256 and
 * hands it to R2 as `sha256` so the object is verified server-side - something
 * the streaming route cannot do (see `asset-routes.ts`).
 */
export async function uploadAsset(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspace: WorkspaceContext,
  input: UploadAssetInput,
  origin: AssetOrigin,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<Asset> {
  const contentType = normalizeAssetContentType(input.contentType);
  if (isBlockedAssetContentType(contentType)) {
    throw new AssetContentTypeBlockedError(contentType);
  }
  const id = uuidv7();
  const key = buildAssetKey(workspace.workspaceId, id, input.name);
  const checksum = await sha256HexFromBytes(input.body);
  await bucket.put(key, input.body, {
    httpMetadata: { contentType },
    customMetadata: { workspaceId: workspace.workspaceId, assetId: id },
    sha256: checksum,
  });
  const now = nowIso();
  const row: AssetRow = {
    id,
    name: input.name,
    originalFilename: input.name,
    kind: assetKindFromContentType(contentType),
    description: "",
    altText: "",
    r2Key: key,
    contentType,
    size: input.body.byteLength,
    checksum,
    checksumAlgorithm: "sha256",
    width: null,
    height: null,
    visibility: input.visibility,
    createdByUserId: workspace.userId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await new AssetRepository(database, workspace).insert(row);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.create",
      resourceType: "asset",
      resourceId: id,
    }),
  );
  return toAsset(row, origin);
}

export interface StreamedUploadInput {
  originalFilename: string;
  contentType: string;
  body: ReadableStream<Uint8Array>;
  declaredSize: number;
  visibility: AssetVisibility;
  width: number | null;
  height: number | null;
}

export type StreamedUploadOutcome =
  | { kind: "size_mismatch" }
  | { kind: "not_found" }
  | { kind: "ok"; asset: Asset };

/**
 * Streams the request body straight into R2 so a 100MB slide deck never lands
 * in the Worker's 128MB heap. The trade-off is integrity: WebCrypto has no
 * incremental SHA-256, so nothing can be handed to `put({ sha256 })` here and
 * the recorded checksum is R2's own MD5 (see `checksumAlgorithm`). It is a
 * content fingerprint for cache-busting, not an integrity attestation.
 */
export async function createStreamedAsset(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspace: WorkspaceContext,
  input: StreamedUploadInput,
  origin: AssetOrigin,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<StreamedUploadOutcome> {
  const id = uuidv7();
  const key = buildAssetKey(workspace.workspaceId, id, input.originalFilename);
  const stored = await putAssetObject(bucket, key, workspace.workspaceId, id, input);
  if (!stored) return { kind: "size_mismatch" };
  const now = nowIso();
  const row: AssetRow = {
    id,
    name: input.originalFilename,
    originalFilename: input.originalFilename,
    kind: assetKindFromContentType(input.contentType),
    description: "",
    altText: "",
    r2Key: key,
    contentType: input.contentType,
    size: stored.size,
    checksum: stored.checksum,
    checksumAlgorithm: stored.checksumAlgorithm,
    width: input.width,
    height: input.height,
    visibility: input.visibility,
    createdByUserId: workspace.userId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await new AssetRepository(database, workspace).insert(row);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.create",
      resourceType: "asset",
      resourceId: id,
      metadata: { streamed: true },
    }),
  );
  return { kind: "ok", asset: toAsset(row, origin) };
}

/**
 * Replaces an asset's bytes while keeping its id, so URLs already embedded in
 * landing pages keep resolving. The new object goes to a fresh key and the old
 * one is deleted only after the row commits.
 */
export async function replaceAssetContent(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspace: WorkspaceContext,
  assetId: string,
  input: StreamedUploadInput,
  origin: AssetOrigin,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<StreamedUploadOutcome> {
  const repository = new AssetRepository(database, workspace);
  const existing = await repository.getById(assetId);
  if (!existing) return { kind: "not_found" };
  const key = buildAssetKey(workspace.workspaceId, assetId, input.originalFilename);
  const stored = await putAssetObject(bucket, key, workspace.workspaceId, assetId, input);
  if (!stored) return { kind: "size_mismatch" };
  const contentPatch = {
    originalFilename: input.originalFilename,
    kind: assetKindFromContentType(input.contentType),
    r2Key: key,
    contentType: input.contentType,
    size: stored.size,
    checksum: stored.checksum,
    checksumAlgorithm: stored.checksumAlgorithm,
    width: input.width,
    height: input.height,
  };
  const updatedAt = await repository.updateContent(assetId, contentPatch);
  const row: AssetRow = { ...existing, ...contentPatch, updatedAt };
  if (existing.r2Key !== key) background.waitUntil(bucket.delete(existing.r2Key));
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.replace",
      resourceType: "asset",
      resourceId: assetId,
    }),
  );
  return { kind: "ok", asset: toAsset(row, origin) };
}

/**
 * The body is passed to R2 untouched: piping it through a TransformStream would
 * erase the known Content-Length that `put` needs for a non-multipart write.
 * A short write is caught afterwards and the partial object removed.
 */
async function putAssetObject(
  bucket: R2Bucket,
  key: string,
  workspaceId: string,
  assetId: string,
  input: StreamedUploadInput,
): Promise<{ size: number; checksum: string; checksumAlgorithm: AssetChecksumAlgorithm } | null> {
  const object = await bucket.put(key, input.body, {
    httpMetadata: { contentType: input.contentType },
    customMetadata: { workspaceId, assetId },
  });
  if (object.size !== input.declaredSize) {
    await bucket.delete(key);
    return null;
  }
  const md5 = object.checksums.md5;
  return {
    size: object.size,
    // R2 always computes MD5 for a single-part put; the etag fallback only
    // guards against a runtime that stops doing so.
    checksum: md5 ? bytesToHex(md5) : object.etag,
    checksumAlgorithm: md5 ? "md5" : "sha256",
  };
}

export async function findAssetForDelivery(
  database: OpenEngageDatabase,
  workspaceId: string,
  assetId: string,
): Promise<{ r2Key: string; name: string; kind: string; contentType: string } | null> {
  const row = await new AssetRepository(database, { workspaceId }).getById(assetId);
  if (!row) return null;
  return { r2Key: row.r2Key, name: row.name, kind: row.kind, contentType: row.contentType };
}

export async function getAssetFile(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspaceId: string,
  assetId: string,
): Promise<File | null> {
  const row = await new AssetRepository(database, { workspaceId }).getById(assetId);
  if (!row) return null;
  const object = await bucket.get(row.r2Key);
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  return new File([bytes], sanitizeFilename(row.name), { type: row.contentType });
}

export type AssetUpdateOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ok"; asset: Asset };

export async function updateAsset(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: AssetUpdateInput,
  origin: AssetOrigin,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<AssetUpdateOutcome> {
  const repository = new AssetRepository(database, workspace);
  const existing = await repository.getById(input.id);
  if (!existing) return { kind: "not_found" };
  if (existing.archivedAt !== null) return { kind: "archived" };
  const metadataPatch = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    altText: input.altText ?? existing.altText,
    visibility: input.visibility ?? existing.visibility,
  };
  const updatedAt = await repository.updateMetadata(input.id, metadataPatch);
  const next: AssetRow = { ...existing, ...metadataPatch, updatedAt };
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.update",
      resourceType: "asset",
      resourceId: input.id,
      metadata: { visibility: next.visibility },
    }),
  );
  return { kind: "ok", asset: toAsset(next, origin) };
}

export async function archiveAsset(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  assetId: string,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<boolean> {
  const changed = await new AssetRepository(database, workspace).archive(assetId);
  if (!changed) return false;
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.archive",
      resourceType: "asset",
      resourceId: assetId,
    }),
  );
  return true;
}

export async function restoreAsset(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  assetId: string,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<boolean> {
  const changed = await new AssetRepository(database, workspace).restore(assetId);
  if (!changed) return false;
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.restore",
      resourceType: "asset",
      resourceId: assetId,
    }),
  );
  return true;
}

/** Removes the row first, then the object - a stray R2 object is cheaper than a dangling row. */
export async function deleteAsset(
  database: OpenEngageDatabase,
  bucket: R2Bucket,
  workspace: WorkspaceContext,
  assetId: string,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<boolean> {
  const repository = new AssetRepository(database, workspace);
  const row = await repository.getById(assetId);
  if (!row) return false;
  const changed = await repository.deleteRow(assetId);
  if (!changed) return false;
  background.waitUntil(bucket.delete(row.r2Key));
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "asset.delete",
      resourceType: "asset",
      resourceId: assetId,
      metadata: { r2Key: row.r2Key },
    }),
  );
  return true;
}
