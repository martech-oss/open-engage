import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders, getRequestUrl } from "@tanstack/react-start/server";

import { authClient } from "@/auth-client";

type CurrentSession = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

export const getCurrentSession = createIsomorphicFn()
  .client(async () => {
    const result = await authClient.getSession();
    return result.data ?? null;
  })
  .server(async (): Promise<CurrentSession | null> => {
    const { env } = await import("cloudflare:workers");
    const request = new Request(new URL("/api/auth/get-session", getRequestUrl()), {
      headers: getRequestHeaders(),
    });
    const response = await env.SERVER.fetch(request);
    if (response.status === 401 || response.status === 204) return null;
    if (!response.ok) throw new Error(`Session request failed with status ${response.status}`);
    return (await response.json()) as CurrentSession | null;
  });

export function safeRedirectTarget(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}
