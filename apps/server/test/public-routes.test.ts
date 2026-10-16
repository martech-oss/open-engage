import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { FORM_FIELDS_MAX, FORM_TEXTAREA_VALUE_MAX_LENGTH } from "@openengage/core/web";

import { PUBLIC_BODY_MAX_BYTES, PUBLIC_FORM_BODY_MAX_BYTES } from "../src/public/http";
import { registerPublicRoutes } from "../src/public/routes";
import { seedWorkspaceClient } from "./factory";

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
    ["/api/public/track/missing-workspace", PUBLIC_BODY_MAX_BYTES],
    ["/f/missing-workspace/missing-form", PUBLIC_FORM_BODY_MAX_BYTES],
    ["/fh/missing-workspace/missing-handler", PUBLIC_FORM_BODY_MAX_BYTES],
  ])("refuses an oversized body on %s before parsing it", async (path, limit) => {
    const oversized = JSON.stringify({ padding: "x".repeat(limit) });
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

  it("fits the largest valid form submission and rejects over-length answers in validation", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);
    const fields = Array.from({ length: FORM_FIELDS_MAX - 1 }, (_, index) => ({
      key: `answer_${index}`,
      kind: "custom" as const,
      type: "textarea" as const,
    }));
    await client.website.createForm({
      name: "Long inquiry",
      slug: "long-inquiry",
      status: "published",
      definition: { fields: [{ key: "email", type: "email", required: true }, ...fields] },
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    });
    const submit = (answer: string) =>
      exports.default.fetch(
        new Request(`http://localhost:8787/f/${slug}/long-inquiry`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "long@example.com",
            idempotencyKey: crypto.randomUUID(),
            ...Object.fromEntries(fields.map((field) => [`custom:${field.key}`, answer])),
          }),
        }),
      );
    // Every field at its limit, in 3-byte characters: well over the beacon ceiling.
    const accepted = await submit("問".repeat(FORM_TEXTAREA_VALUE_MAX_LENGTH));
    expect(accepted.status).toBe(202);

    const tooLong = await submit("問".repeat(FORM_TEXTAREA_VALUE_MAX_LENGTH + 1));
    expect(tooLong.status).toBe(422);
    await expect(tooLong.json()).resolves.toMatchObject({
      error: { code: "invalid_form_fields" },
    });
  });
});
