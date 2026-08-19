import { describe, expect, it } from "vitest";

import { isBackendRequest } from "./server";

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
