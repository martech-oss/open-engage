import startHandler from "@tanstack/react-start/server-entry";

const backendPrefixes = ["/a", "/api", "/c", "/f", "/p", "/r", "/t", "/u", "/preference"] as const;

export function isBackendRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return backendPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default {
  fetch(request: Request, env: CloudflareBindings) {
    if (isBackendRequest(request)) {
      return env.SERVER.fetch(request);
    }
    return startHandler.fetch(request);
  },
} satisfies ExportedHandler<CloudflareBindings>;
