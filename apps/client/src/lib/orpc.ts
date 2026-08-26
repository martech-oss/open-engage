import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { contract } from "@openengage/orpc";

import { createRpcBatchPlugin, rpcRequestMethod } from "./orpc-batching";

const SSR_FORWARDED_HEADERS = [
  "cookie",
  "accept-language",
  "traceparent",
  "tracestate",
  "baggage",
] as const;

const getRpcUrl = createIsomorphicFn()
  .client(() => new URL("/api/rpc", window.location.origin))
  .server(async () => {
    const { env } = await import("cloudflare:workers");
    return new URL("/api/rpc", env.APP_URL);
  });

const getRpcHeaders = createIsomorphicFn()
  .client(() => new Headers())
  .server(async () => {
    const { env } = await import("cloudflare:workers");
    const inbound = getRequestHeaders();
    const headers = new Headers();
    for (const name of SSR_FORWARDED_HEADERS) {
      const value = inbound.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set("origin", new URL(env.APP_URL).origin);
    return headers;
  });

const rpcFetch = createIsomorphicFn()
  .client((request: Request) => fetch(request))
  .server(async (request: Request) => {
    const { env } = await import("cloudflare:workers");
    return env.SERVER.fetch(request);
  });

const link = new RPCLink({
  url: () => getRpcUrl(),
  method: ({ context }) => rpcRequestMethod(context),
  headers: () => getRpcHeaders(),
  fetch: (request) => rpcFetch(request),
  plugins: [createRpcBatchPlugin()],
});

export const orpc: ContractRouterClient<typeof contract> = createORPCClient(link);

export const orpcQuery = createTanstackQueryUtils(orpc);
