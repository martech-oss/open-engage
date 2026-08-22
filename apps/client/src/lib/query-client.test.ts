import { QueryClient, dehydrate, hydrate, queryOptions } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createRequestHandler } from "@tanstack/react-router/ssr/server";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "@/lib/query-client";

describe("query client", () => {
  it("preserves oRPC values through dehydration and hydration", () => {
    const timestamp = new Date("2026-07-29T00:00:00.000Z");
    const source = createQueryClient();
    source.setQueryData(["snapshot", timestamp], {
      createdAt: timestamp,
    });

    const target = createQueryClient();
    hydrate(target, dehydrate(source));

    expect(target.getQueryData<{ createdAt: Date }>(["snapshot", timestamp])).toEqual({
      createdAt: timestamp,
    });
  });

  it("reuses loader data after the real SSR handler dehydration boundary", async () => {
    let networkFetches = 0;
    const initialQuery = queryOptions({
      queryKey: ["initial-viewport"],
      queryFn: async () => {
        networkFetches += 1;
        return { value: "from-server" };
      },
      staleTime: 30_000,
    });

    const createTestRouter = (queryClient: QueryClient) => {
      const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()();
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        loader: ({ context }) => context.queryClient.ensureQueryData(initialQuery),
      });
      const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute]),
        context: { queryClient },
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      setupRouterSsrQueryIntegration({ router, queryClient });
      return router;
    };

    const serverQueryClient = createQueryClient();
    let dehydratedState: ReturnType<typeof dehydrate> | undefined;
    const handleRequest = createRequestHandler({
      request: new Request("https://client.example.test/"),
      createRouter: () => createTestRouter(serverQueryClient),
    });

    const response = await handleRequest(({ router }) => {
      expect(router.serverSsr?.isDehydrated()).toBe(true);
      expect(serverQueryClient.getQueryData(initialQuery.queryKey)).toEqual({
        value: "from-server",
      });
      dehydratedState = dehydrate(serverQueryClient);
      return new Response("rendered");
    });

    expect(await response.text()).toBe("rendered");
    expect(networkFetches).toBe(1);
    expect(dehydratedState).toBeDefined();

    const clientQueryClient = createQueryClient();
    hydrate(clientQueryClient, dehydratedState!);
    const clientRouter = createTestRouter(clientQueryClient);
    await clientRouter.load();

    expect(clientQueryClient.getQueryData(initialQuery.queryKey)).toEqual({
      value: "from-server",
    });
    expect(networkFetches).toBe(1);
  });
});
