import { hmacHex, timingSafeEqual } from "../channels";

interface SignedTokenPayload {
  workspaceId: string;
  resourceId: string;
  contactId?: string;
  expiresAt: number;
  purpose: "tracking" | "unsubscribe" | "reply" | "click";
  /** Click tokens carry the original destination; every other purpose omits it. */
  url?: string;
}

export async function createSignedToken(
  secret: string,
  payload: SignedTokenPayload,
): Promise<string> {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacHex(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function verifySignedToken(
  secret: string,
  token: string,
  purpose: SignedTokenPayload["purpose"],
): Promise<SignedTokenPayload | null> {
  const [encoded, signature, ...rest] = token.split(".");
  if (!encoded || !signature || rest.length > 0) return null;
  const expected = await hmacHex(secret, encoded);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encoded)),
    ) as Partial<SignedTokenPayload>;
    if (
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.resourceId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Date.now() ||
      parsed.purpose !== purpose
    ) {
      return null;
    }
    // A click token is only useful with a destination, and the redirect must
    // never become an open redirect - re-check the scheme even though the HMAC
    // already proves we minted this URL ourselves.
    if (purpose === "click" && !isRedirectableUrl(parsed.url)) return null;
    return parsed as SignedTokenPayload;
  } catch {
    return null;
  }
}

export function isRedirectableUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export async function encryptCredentials(
  masterKey: string,
  value: Record<string, unknown>,
): Promise<string> {
  const key = await importAesKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptCredentials<T extends Record<string, unknown>>(
  masterKey: string,
  encrypted: string,
): Promise<T> {
  const [ivPart, ciphertextPart] = encrypted.split(".");
  if (!ivPart || !ciphertextPart) throw new Error("Invalid encrypted credential payload");
  const key = await importAesKey(masterKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(ciphertextPart),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(digest);
}

export function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importAesKey(masterKey: string): Promise<CryptoKey> {
  const raw = /^[A-Za-z0-9_-]{43}$/.test(masterKey)
    ? base64UrlDecode(masterKey)
    : new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterKey)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sha256HexFromBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return bytesToHex(digest);
}

const IDENTIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomFromAlphabet(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function randomString(length: number): string {
  return randomFromAlphabet(length, `${IDENTIFIER_ALPHABET}-`);
}

/** API key prefixes must satisfy the `[A-Za-z0-9]` auth pattern, so no dashes. */
export function randomIdentifier(length: number): string {
  return randomFromAlphabet(length, IDENTIFIER_ALPHABET);
}
