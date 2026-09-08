import { dehydrate, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { attachRouterServerSsrUtils } from "@tanstack/react-router/ssr/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { SiteTrackingPage } from "@/features/website/site-tracking-page";
import { siteTrackingQueryOptions } from "@/features/website/website-api";
import { createQueryClient } from "@/lib/query-client";
import { WorkspaceTimeProvider } from "@/lib/workspace-time";

import { routeTree } from "../routeTree.gen";

const authState = vi.hoisted(() => ({
  bindingFetch: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    APP_URL: "https://client.example.test",
    SERVER: { fetch: authState.bindingFetch },
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers({ cookie: "session=ssr-cookie" }),
  getRequestUrl: () => new URL("https://client.example.test/"),
}));

async function loadSsrRoute(
  pathname: string,
  seed?: (queryClient: ReturnType<typeof createQueryClient>) => void,
) {
  const queryClient = createQueryClient();
  seed?.(queryClient);
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.load();
  await router.serverSsr?.dehydrate();
  return { queryClient, router };
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
    const { router } = await loadSsrRoute(pathname);

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

  it("authenticates and renders /website/tracking without a browser global", async () => {
    const workspace = {
      id: "workspace-1",
      name: "Workspace",
      slug: "workspace",
      logo: null,
      timezone: "Asia/Tokyo",
      created_at: 0,
      role: "owner" as const,
      capabilities: {
        viewReports: true,
        manageMarketing: true,
        manageWorkspace: true,
        manageApiKeys: true,
      },
    };
    authState.bindingFetch.mockResolvedValue(
      Response.json({
        viewer: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          emailVerified: true,
        },
        workspace,
        workspaces: [{ id: workspace.id, name: workspace.name, slug: workspace.slug }],
        session: {
          id: "session-1",
          token: "session-sentinel-token-from-upstream",
          ipAddress: "session-sentinel-ipAddress-from-upstream",
          userAgent: "session-sentinel-userAgent-from-upstream",
        },
      }),
    );
    const tracking = {
      enabled: true,
      allowedDomains: ["example.com"],
      consentMode: "required" as const,
      workspaceSlug: workspace.slug,
      summary: { pageViews: 0, uniqueVisitors: 0, identifiedContacts: 0 },
      topPages: [],
      recentEvents: [],
      updatedAt: null,
    };
    const { queryClient, router } = await loadSsrRoute("/website/tracking", (client) => {
      client.setQueryData(siteTrackingQueryOptions().queryKey, tracking);
    });

    expect(router.state.redirect).toBeUndefined();
    expect(router.state.matches.at(-1)?.routeId).toBe("/_app/website/tracking");
    const routerMarkup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(authState.bindingFetch).toHaveBeenCalledTimes(1);
    let markup = "";
    expect(() => {
      markup = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            WorkspaceTimeProvider,
            {
              value: {
                timeZone: workspace.timezone,
                renderedAt: "2026-08-23T00:00:00.000Z",
              },
            },
            createElement(SidebarProvider, null, createElement(SiteTrackingPage)),
          ),
        ),
      );
    }).not.toThrow();
    expect(markup).toContain(
      "https://client.example.test/api/public/site-tracking/workspace/script.js",
    );
    const serializedBoundary = JSON.stringify({
      dehydrated: dehydrate(queryClient),
      loaderData: router.state.matches.map((match) => match.loaderData),
      routeContext: router.state.matches.map((match) => match.context),
      markup: `${routerMarkup}${markup}`,
    });
    expect(serializedBoundary).not.toMatch(/session-sentinel|["\\]token["\\]|ipAddress|userAgent/);
    router.serverSsr?.cleanup();
  });
});
