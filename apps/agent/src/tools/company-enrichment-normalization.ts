import type { InspectedPage, SearchDigest, SearchSource } from "./company-enrichment-types";
import {
  assertSafePublicHttpsUrl,
  dedupeBy,
  isSafePublicHttpsUrl,
  safeResolveUrl,
  sameSiteHostname,
} from "./company-enrichment-web";

const MAX_SEARCH_TEXT = 12_000;
const MAX_SOURCE_COUNT = 20;
const MAX_PAGE_TEXT = 15_000;
const MAX_TOTAL_TEXT = 40_000;
const MAX_LINKS = 30;

export function normalizeGatewaySearchResponse(response: unknown): SearchDigest {
  const textParts: string[] = [];
  const sources = new Map<string, SearchSource>();
  let visited = 0;
  const retrievedAt = new Date().toISOString();

  function walk(value: unknown, depth: number): void {
    if (depth > 8 || visited >= 2_000 || value === null || value === undefined) return;
    visited += 1;
    if (typeof value === "string") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;

    if (value.type === "text" && typeof value.text === "string") textParts.push(value.text);
    if (typeof value.url === "string" && isSafePublicHttpsUrl(value.url)) {
      const title =
        typeof value.title === "string" && value.title.trim()
          ? value.title.trim().slice(0, 500)
          : new URL(value.url).hostname;
      sources.set(value.url, { url: value.url, title, retrievedAt });
    }
    for (const nested of Object.values(value)) walk(nested, depth + 1);
  }

  walk(response, 0);
  const rawText = textParts.join("\n\n").trim();
  return {
    answer: rawText.slice(0, MAX_SEARCH_TEXT),
    sources: [...sources.values()].slice(0, MAX_SOURCE_COUNT),
    truncated: rawText.length > MAX_SEARCH_TEXT || sources.size > MAX_SOURCE_COUNT,
  };
}

export function normalizePage(
  pageUrl: string,
  input: Omit<InspectedPage, "url" | "retrievedAt" | "mode">,
  mode: InspectedPage["mode"],
): InspectedPage {
  const baseUrl = assertSafePublicHttpsUrl(pageUrl);
  const links = input.links
    .map((link) => ({ url: safeResolveUrl(link.url, baseUrl.href), text: link.text.slice(0, 300) }))
    .filter(
      (link): link is { url: string; text: string } =>
        Boolean(link.url) && sameSiteHostname(baseUrl.hostname, new URL(link.url).hostname),
    );
  return {
    url: baseUrl.href,
    title: input.title.slice(0, 500) || baseUrl.hostname,
    retrievedAt: new Date().toISOString(),
    description: input.description.slice(0, 1_000),
    text: input.text.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT),
    links: dedupeBy(links, (link) => link.url).slice(0, MAX_LINKS),
    jsonLd: input.jsonLd.map((value) => value.slice(0, 4_000)).slice(0, 8),
    imageCandidates: dedupeBy(
      input.imageCandidates
        .map((url) => safeResolveUrl(url, baseUrl.href))
        .filter((url): url is string => Boolean(url)),
      (url) => url,
    ).slice(0, 12),
    mode,
  };
}

export function capTotalText(pages: InspectedPage[]): InspectedPage[] {
  let remaining = MAX_TOTAL_TEXT;
  return pages.map((page) => {
    const text = page.text.slice(0, Math.max(0, remaining));
    remaining -= text.length;
    return { ...page, text };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
