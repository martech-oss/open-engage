import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import { FORM_FIELDS_MAX, FORM_TEXTAREA_VALUE_MAX_LENGTH } from "@openengage/core/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";

/**
 * Largest body an unauthenticated beacon, preference or auth request needs,
 * including a measurement token and Turnstile response.
 */
export const PUBLIC_BODY_MAX_BYTES = 64 * 1024;

/**
 * A form submission is sized from what validation accepts, so every valid
 * answer fits: each field filled to the longest allowed value, at 9 bytes per
 * UTF-16 unit (a percent-encoded 3-byte character, which also covers any JSON
 * escape), plus the beacon ceiling for keys and tokens.
 */
export const PUBLIC_FORM_BODY_MAX_BYTES =
  FORM_FIELDS_MAX * FORM_TEXTAREA_VALUE_MAX_LENGTH * 9 + PUBLIC_BODY_MAX_BYTES;

/**
 * Counted while the body streams in (or from Content-Length), so an oversized
 * request is refused with 413 before JSON or form-data parsing buffers it.
 */
function publicBodyLimit(maxSize: number): MiddlewareHandler<AppEnvironment> {
  return bodyLimit({
    maxSize,
    onError: (context) => apiError(context, 413, "payload_too_large", "送信内容が大きすぎます"),
  });
}

export const publicRequestBodyLimit = publicBodyLimit(PUBLIC_BODY_MAX_BYTES);
export const publicFormBodyLimit = publicBodyLimit(PUBLIC_FORM_BODY_MAX_BYTES);

export async function safeJson(context: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}
