import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { attachRouterServerSsrUtils } from "@tanstack/react-router/ssr/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/query-client";

import { routeTree } from "../routeTree.gen";

const authState = vi.hoisted(() => ({
  bindingFetch: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { SERVER: { fetch: authState.bindingFetch } },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers({ cookie: "session=ssr-cookie" }),
  getRequestUrl: () => new URL("https://client.example.test/"),
}));

async function loadSsrRoute(pathname: string) {
  const queryClient = createQueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.load();
  await router.serverSsr?.dehydrate();
  return router;
}

describe("SSR router auth redirects", () => {
  beforeEach(() => {
    authState.bindingFetch.mockReset();
  });

  it.each([
    ["protected", "/dashboard"],
    ["onboarding", "/onboarding"],
  ])("redirects an anonymous %s request to login", async (_name, pathname) => {
    authState.bindingFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const router = await loadSsrRoute(pathname);

    expect(authState.bindingFetch).toHaveBeenCalledTimes(1);
    expect(router.state.redirect).toMatchObject({
      options: {
        to: "/login",
        search: { redirect: pathname },
        replace: true,
        statusCode: 307,
      },
    });
    expect(router.state.statusCode).toBe(307);
    router.serverSsr?.cleanup();
  });
});
