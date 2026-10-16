import type { Context, Hono } from "hono";

import { normalizeAssetContentType } from "@openengage/core/assets";
import { GeneratedEmailImageRepository } from "@openengage/database/messaging";

import { ASSET_CSP } from "../assets/response";
import { apiError, resolveWorkspaceAccess, WorkspaceAccessError } from "../auth/access";
import type { AppEnvironment } from "../env";

type RouteContext = Context<AppEnvironment>;

/** Serves only generated images that still belong to the current draft session or were claimed. */
export function registerEmailImageRoutes(app: Hono<AppEnvironment>): void {
  app.get("/api/email-images/:id/preview", async (context) => {
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

    const row = await new GeneratedEmailImageRepository(context.get("database")).getForPreview(
      access.workspace.workspaceId,
      context.req.param("id"),
      new Date().toISOString(),
    );
    const notFound = () =>
      apiError(context, 404, "generated_email_image_not_found", "生成画像が見つかりません");
    // The asset can be replaced after generation, so only a raster image is
    // still treated as the generated preview.
    const contentType = row ? normalizeAssetContentType(row.contentType) : "";
    if (!row || !PREVIEWABLE_IMAGE_TYPES.has(contentType)) return notFound();
    const object = await context.env.ASSETS_BUCKET.get(row.r2Key);
    if (!object) return notFound();

    // Headers are set explicitly rather than copied from the object's stored
    // metadata, and carry the same sandbox as every other asset response.
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Content-Security-Policy": ASSET_CSP,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

const PREVIEWABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

function accessError(context: RouteContext, error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    return apiError(context, error.status, error.code, error.message);
  }
  throw error;
}
