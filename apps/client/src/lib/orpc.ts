import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders, getRequestUrl } from "@tanstack/react-start/server";

import { contract } from "@openengage/orpc";

const getRpcUrl = createIsomorphicFn()
  .client(() => new URL("/api/rpc", window.location.origin))
  .server(() => new URL("/api/rpc", getRequestUrl()));

const getRpcHeaders = createIsomorphicFn()
  .client(() => new Headers())
  .server(() => getRequestHeaders());

const rpcFetch = createIsomorphicFn()
  .client((request: Request) => fetch(request))
  .server(async (request: Request) => {
    const { env } = await import("cloudflare:workers");
    const headers = new Headers(getRequestHeaders());
    for (const [name, value] of request.headers) headers.set(name, value);
    return env.SERVER.fetch(new Request(request, { headers }));
  });

const link = new RPCLink({
  url: () => getRpcUrl(),
  headers: () => getRpcHeaders(),
  fetch: (request) => rpcFetch(request),
});

export const orpc: ContractRouterClient<typeof contract> = createORPCClient(link);

export const orpcQuery = createTanstackQueryUtils(orpc);
