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
  idempotency?: { workspaceId: string; formId: string; publicKey: string },
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  if (idempotency) {
    body.set(
      "idempotency_key",
      await turnstileVerificationIdempotencyKey({ ...idempotency, token }),
    );
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

const TURNSTILE_IDEMPOTENCY_NAMESPACE = "f65c78e650e94a24a9fdd82b31ff502a";

async function turnstileVerificationIdempotencyKey(scope: {
  workspaceId: string;
  formId: string;
  publicKey: string;
  token: string;
}): Promise<string> {
  const namespace = Uint8Array.from(TURNSTILE_IDEMPOTENCY_NAMESPACE.match(/.{2}/g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );
  const name = new TextEncoder().encode(
    JSON.stringify([scope.workspaceId, scope.formId, scope.publicKey, scope.token]),
  );
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", input)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function hashIp(value?: string): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}
