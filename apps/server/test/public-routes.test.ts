import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerPublicRoutes } from "../src/public/routes";

/**
 * The public surface is unauthenticated and embedded in customer sites, so a
 * route silently disappearing (or a path changing shape) breaks live installs.
 * Hono also matches in registration order, so the order is asserted too.
 */
describe("public routes", () => {
  it("registers the expected paths in order", () => {
    const app = new Hono();
    registerPublicRoutes(app as never);

    expect(app.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /a/:workspaceSlug/:id/:filename",
      "HEAD /a/:workspaceSlug/:id/:filename",
      "GET /p/:workspaceSlug/:pageSlug",
      "GET /api/public/forms/:workspaceSlug/:formSlug/embed.js",
      "GET /f/:workspaceSlug/:formSlug",
      "POST /f/:workspaceSlug/:formSlug",
      "GET /api/public/site-tracking/:workspaceSlug/script.js",
      "POST /api/public/track/:workspaceSlug",
      "GET /t/:token",
      "GET /c/:token",
      "GET /r/:workspaceSlug/:redirectSlug",
      "GET /api/public/site-messages/:workspaceSlug",
      "POST /api/public/site-messages/:workspaceSlug/:messageId/events",
      "GET /u/:token",
      "POST /u/:token",
      "GET /preference/:token",
      "POST /preference/:token",
    ]);
  });
});
