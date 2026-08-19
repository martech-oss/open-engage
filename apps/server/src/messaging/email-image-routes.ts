import type { Context, Hono } from "hono";

import { GeneratedEmailImageRepository } from "@openengage/database/messaging";

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
    if (!row) return notFound();
    const object = await context.env.ASSETS_BUCKET.get(row.r2Key);
    if (!object) return notFound();

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": row.contentType,
      "X-Content-Type-Options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });
}

function accessError(context: RouteContext, error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    return apiError(context, error.status, error.code, error.message);
  }
  throw error;
}
