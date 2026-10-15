import { exports } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { PUBLIC_BODY_MAX_BYTES } from "../src/public/http";
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
      "ALL /f/*",
      "ALL /fh/*",
      "ALL /api/public/*",
      "ALL /u/*",
      "ALL /preference/*",
      "GET /a/:workspaceSlug/:id/:filename",
      "HEAD /a/:workspaceSlug/:id/:filename",
      "GET /p/:workspaceSlug/:pageSlug",
      "POST /api/public/landing/:workspaceSlug/:pageSlug/resolve",
      "POST /api/public/landing/events",
      "POST /f/:workspaceSlug/:formSlug/fields",
      "GET /api/public/forms/:workspaceSlug/:formSlug/embed.js",
      "GET /f/:workspaceSlug/:formSlug",
      "POST /f/:workspaceSlug/:formSlug",
      "OPTIONS /fh/:workspaceSlug/:handlerSlug",
      "POST /fh/:workspaceSlug/:handlerSlug",
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

  it.each([
    "/api/public/track/missing-workspace",
    "/f/missing-workspace/missing-form",
    "/fh/missing-workspace/missing-handler",
  ])("refuses an oversized body on %s before parsing it", async (path) => {
    const oversized = JSON.stringify({ padding: "x".repeat(PUBLIC_BODY_MAX_BYTES) });
    const declared = await exports.default.fetch(
      new Request(`http://localhost:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized,
      }),
    );
    expect(declared.status).toBe(413);
    await expect(declared.json()).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    });

    // Without Content-Length the limit is enforced while the stream is read.
    const encoded = new TextEncoder().encode(oversized);
    const streamed = await exports.default.fetch(
      new Request(`http://localhost:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
        body: new ReadableStream({
          start(controller) {
            for (let offset = 0; offset < encoded.length; offset += 8_192)
              controller.enqueue(encoded.slice(offset, offset + 8_192));
            controller.close();
          },
        }),
      }),
    );
    expect(streamed.status).toBe(413);
  });

  it("still serves ordinary public requests under the limit", async () => {
    const response = await exports.default.fetch(
      new Request("http://localhost:8787/api/public/track/missing-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true, type: "page_viewed" }),
      }),
    );
    expect(response.status).toBe(202);
  });
});
