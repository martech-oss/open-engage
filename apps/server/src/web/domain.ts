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

export function pagePatternMatches(pageUrl: string, pattern: string): boolean {
  if (pattern === "*") return true;
  let path = pageUrl;
  try {
    const url = new URL(pageUrl);
    path = `${url.pathname}${url.search}`;
  } catch {
    // Use the supplied path as-is.
  }
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(path);
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
