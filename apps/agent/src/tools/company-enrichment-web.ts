export function assertSafePublicHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only unauthenticated HTTPS URLs are allowed");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedHostname(hostname)) {
    throw new Error(`Private or local hostname is not allowed: ${hostname}`);
  }
  return url;
}

export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    assertSafePublicHttpsUrl(value);
    return true;
  } catch {
    return false;
  }
}

function isBlockedHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  if (hostname.includes(":")) {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const mappedIpv4 = mappedIpv4Octets(normalized);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      (mappedIpv4 !== null && isBlockedIpv4(mappedIpv4))
    );
  }
  const octets = parseIpv4Octets(hostname);
  if (octets === null) return false;
  return isBlockedIpv4(octets);
}

function mappedIpv4Octets(hostname: string): number[] | null {
  const words = parseIpv6Words(hostname);
  if (words === null || words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) {
    return null;
  }
  const high = words[6] ?? 0;
  const low = words[7] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function parseIpv6Words(value: string): number[] | null {
  let normalized = value;
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const octets = parseIpv4Octets(normalized.slice(separator + 1));
    if (separator < 0 || octets === null) return null;
    const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    normalized = `${normalized.slice(0, separator)}:${high}:${low}`;
  }

  const compression = normalized.indexOf("::");
  if (compression !== normalized.lastIndexOf("::")) return null;
  const left = (compression >= 0 ? normalized.slice(0, compression) : normalized)
    .split(":")
    .filter(Boolean);
  const right = (compression >= 0 ? normalized.slice(compression + 2) : "")
    .split(":")
    .filter(Boolean);
  const omitted = compression >= 0 ? 8 - left.length - right.length : 0;
  const groups = compression >= 0 ? [...left, ...Array(omitted).fill("0"), ...right] : left;
  if (
    groups.length !== 8 ||
    omitted < 0 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

function parseIpv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((part) => part < 0 || part > 255) ? null : octets;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export async function readTextLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new Error("HTML response exceeded the byte limit");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function timedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new DOMException("Aborted", "AbortError"));
  parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export function findMetaContent(html: string, value: string, attribute = "name"): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = new RegExp(
    `<meta\\b[^>]*${attribute}\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    "i",
  );
  const second = new RegExp(
    `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attribute}\\s*=\\s*["']${escaped}["'][^>]*>`,
    "i",
  );
  return decodeHtml(firstMatch(html, first) || firstMatch(html, second)).trim();
}

export function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtml(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

export function firstMatch(value: string, pattern: RegExp): string {
  return pattern.exec(value)?.[1] ?? "";
}

export function safeResolveUrl(value: string, base: string): string {
  try {
    const resolved = new URL(value, base);
    return isSafePublicHttpsUrl(resolved.href) ? resolved.href : "";
  } catch {
    return "";
  }
}

export function sameSiteHostname(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
