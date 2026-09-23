import * as z from "zod";

import { assetKindSchema, assetVisibilitySchema, type AssetKind } from "../shared/schema";

/**
 * The buffered oRPC `upload` procedure materialises the whole file in Worker
 * memory (128MB limit), so it stays conservative. The streaming route at
 * `POST /api/assets/upload` pipes straight into R2 and is bounded instead by
 * Cloudflare's inbound request-body ceiling - 100MB on Free/Pro, higher on
 * Business/Enterprise. Neither number is a OpenEngage preference.
 */
export const ASSET_BUFFERED_MAX_BYTES = 25 * 1024 * 1024;
export const ASSET_STREAM_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Assets are served from the same origin as the admin app, so anything the
 * browser would execute as script becomes a session-theft vector. Responses
 * also carry a locked-down CSP, but refusing these at upload keeps the bytes
 * out of R2 in the first place.
 */
export const ASSET_BLOCKED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "application/wasm",
  "application/x-httpd-php",
] as const;

export function isBlockedAssetContentType(contentType: string): boolean {
  return (ASSET_BLOCKED_CONTENT_TYPES as readonly string[]).includes(
    normalizeAssetContentType(contentType),
  );
}

/** Strips parameters (`; charset=…`) and lowercases, so comparisons are stable. */
export function normalizeAssetContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

/**
 * Shared by the server (which persists `kind`) and the client (which labels the
 * filter tabs), so the two can never disagree about what counts as an image.
 */
export function assetKindFromContentType(contentType: string): AssetKind {
  const normalized = normalizeAssetContentType(contentType);
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (
    normalized === "application/pdf" ||
    normalized.startsWith("text/") ||
    normalized.includes("officedocument") ||
    normalized.includes("opendocument") ||
    normalized === "application/msword" ||
    normalized === "application/vnd.ms-excel" ||
    normalized === "application/vnd.ms-powerpoint" ||
    normalized === "application/epub+zip"
  ) {
    return "document";
  }
  return "other";
}

/** The public delivery path. `filename` is cosmetic - lookups key on `id`. */
export function assetPublicPath(workspaceSlug: string, id: string, filename: string): string {
  return `/a/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;
}

const assetStatusFilterSchema = z.enum(["active", "archived", "all"]);
export type AssetStatusFilter = z.infer<typeof assetStatusFilterSchema>;

export const assetListInputSchema = z.object({
  query: z.string().trim().max(191).optional(),
  kind: assetKindSchema.optional(),
  visibility: assetVisibilitySchema.optional(),
  status: assetStatusFilterSchema.default("active"),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type AssetListInput = z.infer<typeof assetListInputSchema>;

export const assetIdInputSchema = z.object({ id: z.string().min(1) });
export type AssetIdInput = z.infer<typeof assetIdInputSchema>;

export const assetUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(191).optional(),
  description: z.string().trim().max(2_000).optional(),
  altText: z.string().trim().max(500).optional(),
  visibility: assetVisibilitySchema.optional(),
});
export type AssetUpdateInput = z.infer<typeof assetUpdateInputSchema>;

/** Pixel bounds for the client-measured dimensions accepted by the upload routes. */
export const assetDimensionSchema = z.number().int().min(1).max(100_000);
