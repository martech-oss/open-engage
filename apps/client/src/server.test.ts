import { describe, expect, it } from "vitest";

import { isBackendRequest, withDocumentNoStore } from "./server";

/**
 * This function decides whether a request reaches the API Worker or the
 * TanStack Start app. A prefix that is too greedy silently swallows a UI route;
 * one that is missing breaks a public endpoint on live installs. The `/a`
 * (public assets) and `/c` (email click redirect) prefixes are the sharp
 * edges - `/automations`, `/companies`, `/contacts` and `/reports` all start
 * with one.
 */
describe("isBackendRequest", () => {
  const backend = [
    "/a/acme/019f.../guide.pdf",
    "/a",
    "/api/rpc",
    "/api/mcp",
    "/api/assets/019f.../raw",
    "/f/acme/contact",
    "/p/acme/spring",
    "/c/token",
    "/r/acme/spring-ad",
    "/t/token",
    "/u/token",
    "/preference/token",
  ];
  const frontend = [
    "/",
    "/automations",
    "/automations/019f...",
    "/analytics",
    "/apidocs",
    "/assets",
    "/companies",
    "/companies/019f...",
    "/contacts",
    "/reports",
    "/website/assets",
    "/dashboard",
    "/preferences",
  ];

  it.each(backend)("routes %s to the API Worker", (path) => {
    expect(isBackendRequest(new Request(`http://localhost${path}`))).toBe(true);
  });

  it.each(frontend)("routes %s to the app", (path) => {
    expect(isBackendRequest(new Request(`http://localhost${path}`))).toBe(false);
  });
});

describe("withDocumentNoStore", () => {
  it("marks TanStack document HTML private and non-cacheable", async () => {
    const response = withDocumentNoStore(
      new Request("https://app.example.test/dashboard", {
        headers: { accept: "text/html" },
      }),
      new Response("<!doctype html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      }),
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toBe("<!doctype html>");
  });

  it.each([
    ["redirect", new Response(null, { status: 307, headers: { location: "/login" } })],
    ["no-content", new Response(null, { status: 204 })],
  ])("marks document %s responses private and non-cacheable", (_name, original) => {
    const response = withDocumentNoStore(
      new Request("https://app.example.test/dashboard", {
        headers: { "sec-fetch-dest": "document" },
      }),
      original,
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.status).toBe(original.status);
  });

  it("does not rewrite non-document asset caching", () => {
    const response = withDocumentNoStore(
      new Request("https://app.example.test/assets/app.css", {
        headers: { accept: "text/css,*/*;q=0.1", "sec-fetch-dest": "style" },
      }),
      new Response("body{}", {
        headers: { "content-type": "text/css", "cache-control": "public, max-age=31536000" },
      }),
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
  });
});
