import type { Context, Hono } from "hono";

import {
  ASSET_STREAM_MAX_BYTES,
  assetDimensionSchema,
  isBlockedAssetContentType,
  normalizeAssetContentType,
  type Asset,
} from "@openengage/core/assets";
import { assetVisibilitySchema, type AssetVisibility } from "@openengage/core/shared";
import { forbiddenError, workspaceErrors } from "@openengage/orpc";

import { apiError, resolveWorkspaceAccess, WorkspaceAccessError } from "../auth/access";
import { hasWorkspaceRole } from "../auth/authorization";
import type { AppEnvironment } from "../env";
import { serveAssetObject } from "./response";
import {
  createStreamedAsset,
  findAssetForDelivery,
  loadAssetOrigin,
  replaceAssetContent,
  type StreamedUploadInput,
} from "./service";

type RouteContext = Context<AppEnvironment>;

function resolveAssetOrigin(context: RouteContext, workspaceId: string) {
  return loadAssetOrigin(context.get("database"), workspaceId, context.env.APP_URL);
}

/**
 * Byte-moving routes that the oRPC contract cannot express: `z.file()` buffers
 * the whole body into Worker memory and its serializer owns the response, so
 * neither an unbuffered upload nor `Range`/`ETag`/`Content-Disposition` on the
 * way out is reachable through it. Response bodies are still typed as the
 * contract's `Asset` DTO so they cannot drift from it.
 */
export function registerAssetRoutes(app: Hono<AppEnvironment>): void {
  app.post("/api/assets/upload", async (context) => {
    const access = await authorizeAssetWrite(context);
    if (access instanceof Response) return access;

    const url = new URL(context.req.url);
    const originalFilename = (url.searchParams.get("name") ?? "").trim().slice(0, 191);
    if (!originalFilename) {
      return apiError(context, 400, "asset_name_required", "ファイル名が必要です");
    }
    const parsed = readStreamedBody(context, url, originalFilename);
    if (parsed instanceof Response) return parsed;

    const origin = await resolveAssetOrigin(context, access.workspaceId);
    const outcome = await createStreamedAsset(
      context.get("database"),
      context.env.ASSETS_BUCKET,
      access,
      parsed,
      origin,
      context.executionCtx,
    );
    if (outcome.kind !== "ok") return sizeMismatch(context);
    const payload: Asset = outcome.asset;
    return context.json(payload, 201);
  });

  app.put("/api/assets/:id/content", async (context) => {
    const access = await authorizeAssetWrite(context);
    if (access instanceof Response) return access;

    const url = new URL(context.req.url);
    const existing = await findAssetForDelivery(
      context.get("database"),
      access.workspaceId,
      context.req.param("id"),
    );
    if (!existing) {
      return apiError(context, 404, "asset_not_found", "アセットが見つかりません");
    }
    const fallbackName = (url.searchParams.get("name") ?? existing.name).trim().slice(0, 191);
    const parsed = readStreamedBody(context, url, fallbackName || existing.name);
    if (parsed instanceof Response) return parsed;

    const origin = await resolveAssetOrigin(context, access.workspaceId);
    const outcome = await replaceAssetContent(
      context.get("database"),
      context.env.ASSETS_BUCKET,
      access,
      context.req.param("id"),
      parsed,
      origin,
      context.executionCtx,
    );
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "asset_not_found", "アセットが見つかりません");
    }
    if (outcome.kind !== "ok") return sizeMismatch(context);
    const payload: Asset = outcome.asset;
    return context.json(payload, 200);
  });

  // Backs the admin image grid and private downloads. Serves archived and
  // private assets too - membership is the only gate.
  app.on(["GET", "HEAD"], "/api/assets/:id/raw", async (context) => {
    let access;
    try {
      access = await resolveWorkspaceAccess({
        database: context.get("database"),
        env: context.env,
        headers: context.req.raw.headers,
        method: context.req.method,
        executionContext: context.executionCtx,
      });
    } catch (error) {
      return accessError(context, error);
    }
    const row = await findAssetForDelivery(
      context.get("database"),
      access.workspace.workspaceId,
      context.req.param("id"),
    );
    const notFound = () => apiError(context, 404, "asset_not_found", "アセットが見つかりません");
    if (!row) return notFound();
    const response = await serveAssetObject(
      context.env.ASSETS_BUCKET,
      row.r2Key,
      context.req.raw,
      { name: row.name, kind: row.kind, contentType: row.contentType },
      // Authenticated response: it must never be held by a shared cache.
      "private, max-age=0, must-revalidate",
    );
    return response ?? notFound();
  });
}

async function authorizeAssetWrite(
  context: RouteContext,
): Promise<Response | Awaited<ReturnType<typeof resolveWorkspaceAccess>>["workspace"]> {
  // Checked before authentication so a cross-site POST is rejected without
  // costing a session lookup. resolveWorkspaceAccess only rejects a *mismatched*
  // Origin, and these routes sit outside the oRPC middleware, so a
  // cookie-authenticated request with no Origin at all is closed off here.
  // Browsers always send Origin on requests shaped like these.
  const usesBearer = context.req.header("authorization")?.startsWith("Bearer ") ?? false;
  if (!usesBearer) {
    const origin = context.req.header("origin");
    if (!origin || origin !== new URL(context.env.APP_URL).origin) {
      return apiError(context, 403, "origin_mismatch", workspaceErrors.ORIGIN_MISMATCH.message);
    }
  }
  let access;
  try {
    access = await resolveWorkspaceAccess({
      database: context.get("database"),
      env: context.env,
      headers: context.req.raw.headers,
      method: context.req.method,
      executionContext: context.executionCtx,
    });
  } catch (error) {
    return accessError(context, error);
  }
  if (!hasWorkspaceRole(access.workspace.role, "marketer")) {
    return apiError(context, 403, "forbidden", forbiddenError.FORBIDDEN.message);
  }
  return access.workspace;
}

function readStreamedBody(
  context: RouteContext,
  url: URL,
  originalFilename: string,
): Response | StreamedUploadInput {
  const declaredSize = Number(context.req.header("content-length"));
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return apiError(context, 411, "length_required", "Content-Lengthヘッダーが必要です");
  }
  if (declaredSize > ASSET_STREAM_MAX_BYTES) {
    return apiError(context, 413, "asset_too_large", "ファイルサイズが上限を超えています");
  }
  const contentType = normalizeAssetContentType(context.req.header("content-type") ?? "");
  if (isBlockedAssetContentType(contentType)) {
    return apiError(
      context,
      415,
      "asset_content_type_blocked",
      "このファイル形式はアップロードできません",
    );
  }
  const body = context.req.raw.body;
  if (!body) return apiError(context, 400, "asset_body_required", "ファイル本文がありません");

  const visibility = assetVisibilitySchema.safeParse(url.searchParams.get("visibility") ?? "");
  return {
    originalFilename,
    contentType,
    body,
    declaredSize,
    visibility: visibility.success ? visibility.data : ("private" satisfies AssetVisibility),
    width: readDimension(url.searchParams.get("width")),
    height: readDimension(url.searchParams.get("height")),
  };
}

function readDimension(value: string | null): number | null {
  const parsed = assetDimensionSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : null;
}

function sizeMismatch(context: RouteContext): Response {
  return apiError(context, 400, "asset_size_mismatch", "アップロードが中断されました");
}

function accessError(context: RouteContext, error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    return apiError(context, error.status, error.code, error.message);
  }
  throw error;
}
