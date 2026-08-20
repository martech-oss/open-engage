import { normalizePage } from "./company-enrichment-normalization";
import type { InspectedPage } from "./company-enrichment-types";
import {
  assertSafePublicHttpsUrl,
  decodeHtml,
  dedupeBy,
  findMetaContent,
  firstMatch,
  safeResolveUrl,
  sameSiteHostname,
  stripHtml,
} from "./company-enrichment-web";

export function extractHtmlPage(
  pageUrl: string,
  html: string,
  mode: InspectedPage["mode"] = "static",
): InspectedPage {
  const title = decodeHtml(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).trim();
  const metaDescription = findMetaContent(html, "description");
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: safeResolveUrl(match[1] ?? "", pageUrl),
      text: stripHtml(match[2] ?? "").slice(0, 300),
    }))
    .filter((link): link is { url: string; text: string } => Boolean(link.url));
  const jsonLd = [
    ...html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);
  const imageCandidates = [
    findMetaContent(html, "og:image", "property"),
    ...[...html.matchAll(/<img\b[^>]*(?:alt|class|id)\s*=\s*["'][^"']*logo[^"']*["'][^>]*>/gi)]
      .map((match) => firstMatch(match[0], /\bsrc\s*=\s*["']([^"']+)["']/i))
      .map((url) => safeResolveUrl(url, pageUrl)),
  ].filter(Boolean);
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  return normalizePage(
    pageUrl,
    {
      title,
      description: metaDescription,
      text: stripHtml(withoutNoise),
      links,
      jsonLd,
      imageCandidates,
    },
    mode,
  );
}

export function selectRelevantLinks(
  baseUrl: string,
  links: Array<{ url: string; text: string }>,
): string[] {
  const base = assertSafePublicHttpsUrl(baseUrl);
  const keywords =
    /about|company|corporate|profile|overview|service|product|business|contact|会社|企業|概要|事業|製品|サービス|問い合わせ|アクセス/i;
  return dedupeBy(
    links
      .filter((link) => {
        try {
          const url = assertSafePublicHttpsUrl(link.url);
          return (
            sameSiteHostname(base.hostname, url.hostname) &&
            keywords.test(`${url.pathname} ${link.text}`) &&
            !url.pathname.match(/login|signin|signup|account|privacy|terms|recruit|career/i)
          );
        } catch {
          return false;
        }
      })
      .map((link) => new URL(link.url).href),
    (url) => url,
  );
}
