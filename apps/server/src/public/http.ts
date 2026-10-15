import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";

/**
 * Largest body any unauthenticated endpoint accepts. A form with every field
 * filled, its measurement token and Turnstile response fits comfortably.
 */
export const PUBLIC_BODY_MAX_BYTES = 64 * 1024;

/**
 * Counted while the body streams in (or from Content-Length), so an oversized
 * request is refused with 413 before JSON or form-data parsing buffers it.
 */
export const publicBodyLimit: MiddlewareHandler<AppEnvironment> = bodyLimit({
  maxSize: PUBLIC_BODY_MAX_BYTES,
  onError: (context) => apiError(context, 413, "payload_too_large", "送信内容が大きすぎます"),
});

export async function safeJson(context: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}
