import { exports } from "cloudflare:workers";

/** POSTs a JSON body to a public (unauthenticated) route through the Worker entrypoint. */
export function publicPost(path: string, body: Record<string, unknown>): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
