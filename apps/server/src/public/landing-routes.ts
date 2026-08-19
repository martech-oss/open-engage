import type { Hono } from "hono";

import { PublicWebRepository } from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { renderContent } from "../rendering/content-renderer";

export function registerPublicLandingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const page = await new PublicWebRepository(context.get("database")).findPublishedLandingPage(
      context.req.param("workspaceSlug"),
      context.req.param("pageSlug"),
    );
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const rendered = renderContent(page.contentDocument, {
      contact: {},
      workspace: { name: page.workspaceName },
    });
    return context.html(rendered.html);
  });
}
