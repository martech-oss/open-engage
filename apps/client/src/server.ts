import startHandler from "@tanstack/react-start/server-entry";

const backendPrefixes = [
  "/a",
  "/api",
  "/c",
  "/f",
  "/fh",
  "/p",
  "/r",
  "/t",
  "/u",
  "/preference",
] as const;

export function isBackendRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return backendPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function withDocumentNoStore(request: Request, response: Response): Response {
  const responseIsHtml = response.headers.get("content-type")?.toLowerCase().includes("text/html");
  const requestIsDocument =
    request.headers.get("sec-fetch-dest")?.toLowerCase() === "document" ||
    request.headers.get("accept")?.toLowerCase().includes("text/html");
  if (!responseIsHtml && !requestIsDocument) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: CloudflareBindings) {
    if (isBackendRequest(request)) {
      return env.SERVER.fetch(request);
    }
    return withDocumentNoStore(request, await startHandler.fetch(request));
  },
} satisfies ExportedHandler<CloudflareBindings>;
