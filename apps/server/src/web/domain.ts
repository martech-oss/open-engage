export function originAllowed(origin: string, allowedDomains: string[]): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const allowed = domain.toLowerCase();
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
}

export function normalizeDomain(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    return (
      value
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0] ?? ""
    );
  }
}

export function isValidDomain(value: string): boolean {
  return (
    value === "localhost" || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
  );
}

// Browsers and CDNs cap URLs well below this; longer input is not a real page.
const PAGE_PATH_MAX_LENGTH = 8_192;

export function pagePatternMatches(pageUrl: string, pattern: string): boolean {
  if (pattern === "*") return true;
  let path = pageUrl;
  try {
    const url = new URL(pageUrl);
    path = `${url.pathname}${url.search}`;
  } catch {
    // Use the supplied path as-is.
  }
  if (path.length > PAGE_PATH_MAX_LENGTH) return false;
  return globMatches(path, pattern);
}

/**
 * `*` matches any run of characters. Literal segments are matched left to
 * right with `indexOf`, taking the earliest fit for each: with only `*` as a
 * wildcard that choice never loses a match, so nothing is backtracked and the
 * cost stays linear in the path for each segment.
 */
function globMatches(path: string, pattern: string): boolean {
  const segments = pattern.split("*");
  if (segments.length === 1) return path === pattern;
  const first = segments[0]!;
  const last = segments.at(-1)!;
  if (path.length < first.length + last.length) return false;
  if (!path.startsWith(first) || !path.endsWith(last)) return false;
  const end = path.length - last.length;
  let cursor = first.length;
  for (const segment of segments.slice(1, -1)) {
    if (!segment) continue;
    const index = path.indexOf(segment, cursor);
    if (index < 0 || index + segment.length > end) return false;
    cursor = index + segment.length;
  }
  return true;
}

export function redactFormPayload(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  delete result["turnstileToken"];
  delete result["cf-turnstile-response"];
  delete result["idempotencyKey"];
  delete result["oe_v"];
  delete result["_website"];
  delete result["measurementToken"];
  return result;
}
