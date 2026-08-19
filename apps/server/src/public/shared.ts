import { type OpenEngageDatabase, PublicWebRepository } from "@openengage/database";

import { sha256Hex } from "../platform/crypto";

export function hasTurnstileConfiguration(env: {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET?.trim());
}

export async function loadPublicTrackingWorkspace(
  database: OpenEngageDatabase,
  workspaceSlug: string,
): Promise<{ id: string; allowedDomains: string[] } | null> {
  return new PublicWebRepository(database).findTrackingWorkspace(workspaceSlug);
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  if (idempotencyKey) body.set("idempotency_key", idempotencyKey);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export async function hashIp(value?: string): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}
