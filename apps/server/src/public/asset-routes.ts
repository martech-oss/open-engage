import type { Hono } from "hono";

import { PublicAssetRepository } from "@openengage/database/assets";

import { serveAssetObject } from "../assets/response";
import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";

/** Only `?v=<checksum prefix>` earns the year-long cache; bare URLs revalidate often. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE = "public, max-age=300, must-revalidate";

export function registerPublicAssetRoutes(publicApp: Hono<AppEnvironment>): void {
  // `app.get` does not match HEAD, and both browsers and CDNs send it.
  publicApp.on(["GET", "HEAD"], "/a/:workspaceSlug/:id/:filename", async (context) => {
    // Every failure below - unknown workspace, unknown asset, private, archived,
    // missing object - returns this same 404 so the route leaks no existence.
    const notFound = () => apiError(context, 404, "asset_not_found", "アセットが見つかりません");

    const row = await new PublicAssetRepository(context.get("database")).findPublicAsset(
      context.req.param("workspaceSlug"),
      context.req.param("id"),
    );
    if (!row) return notFound();

    // The row lookup already confines us to public asset rows, but the bucket is
    // shared with contact CSV exports, inbound email attachments and event
    // archives - so a corrupted key becomes a 404 rather than a PII leak.
    if (!row.r2Key.startsWith(`${row.workspaceId}/assets/`)) return notFound();

    const version = new URL(context.req.url).searchParams.get("v");
    const response = await serveAssetObject(
      context.env.ASSETS_BUCKET,
      row.r2Key,
      context.req.raw,
      { name: row.name, kind: row.kind, contentType: row.contentType },
      version === row.checksum.slice(0, 12) ? IMMUTABLE_CACHE : REVALIDATE_CACHE,
      // Public assets are embedded on customer sites, where <canvas> and
      // webfont loads need CORS.
      { "access-control-allow-origin": "*" },
    );
    return response ?? notFound();
  });
}
