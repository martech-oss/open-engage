import { launch, type BrowserWorker, type Page } from "@cloudflare/playwright";
import { defineTool, type JsonValue } from "@flue/runtime";
import * as v from "valibot";

import {
  companyEnrichmentFieldNameSchema,
  type CompanyEnrichmentFieldName,
} from "@openengage/core/contacts";

import {
  assertSafePublicHttpsUrl,
  decodeHtml,
  dedupeBy,
  errorMessage,
  findMetaContent,
  firstMatch,
  isSafePublicHttpsUrl,
  readTextLimited,
  safeResolveUrl,
  sameSiteHostname,
  stripHtml,
  timedSignal,
} from "./company-enrichment-web";

export { assertSafePublicHttpsUrl, isSafePublicHttpsUrl } from "./company-enrichment-web";

const SEARCH_MODEL = "anthropic/claude-haiku-4.5";
const MAX_SEARCH_TEXT = 12_000;
const MAX_SOURCE_COUNT = 20;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PAGE_TEXT = 15_000;
const MAX_TOTAL_TEXT = 40_000;
const MAX_LINKS = 30;
const MAX_PAGES = 4;
const MAX_BROWSER_PAGES = 3;
const STATIC_FETCH_TIMEOUT_MS = 12_000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000;

const fieldNames = companyEnrichmentFieldNameSchema.options;

export interface CompanyEnrichmentToolBindings {
  AI: Ai;
  BROWSER: BrowserWorker;
}

export interface SearchSource {
  url: string;
  title: string;
  retrievedAt: string;
}

export interface SearchDigest {
  answer: string;
  sources: SearchSource[];
  truncated: boolean;
}

export interface InspectedPage {
  url: string;
  title: string;
  retrievedAt: string;
  description: string;
  text: string;
  links: Array<{ url: string; text: string }>;
  jsonLd: string[];
  imageCandidates: string[];
  mode: "static" | "browser";
}

export interface WebsiteInspection {
  requestedUrl: string;
  pages: InspectedPage[];
  browserUsed: boolean;
  warnings: string[];
}

export type InspectionPage = Pick<Page, "route" | "goto" | "url" | "evaluate">;
export interface InspectionBrowser {
  newPage(): Promise<InspectionPage>;
  close(): Promise<void>;
}
export type BrowserLauncher = (binding: BrowserWorker) => Promise<InspectionBrowser>;

export function createCompanyEnrichmentTools(bindings: CompanyEnrichmentToolBindings) {
  const resolveCompanyOfficialSite = defineTool({
    name: "resolve_company_official_site",
    description:
      "Search the public web through Cloudflare AI Gateway to identify official HTTPS website candidates for one company name. Use only when the input has no domain. This tool never visits or changes a website.",
    input: v.object({
      companyName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(191)),
    }),
    durable: true,
    async run({ data, signal, step }) {
      const result = await step.do("resolve-official-site", () =>
        runGatewaySearch(
          bindings.AI,
          `Identify the official website for the company named ${JSON.stringify(data.companyName)}. ` +
            "Return up to five plausible candidates with company name, canonical HTTPS URL, domain, and a short evidence-based reason. " +
            "Prefer the company's own website and do not treat directories or social profiles as official websites. " +
            "If more than one company plausibly matches, keep the alternatives and say that confirmation is required.",
          signal,
        ),
      );
      return { output: toJsonValue(result) };
    },
  });

  const inspectCompanyWebsite = defineTool({
    name: "inspect_company_website",
    description:
      "Read a public company website without interacting with it. It fetches bounded static HTML first and uses Cloudflare Playwright only for sparse or JavaScript-rendered pages. It inspects at most four company/about/services/contact pages.",
    input: v.object({
      url: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_048)),
    }),
    durable: true,
    async run({ data, signal, step }) {
      const result = await step.do("inspect-company-website", () =>
        inspectWebsite(data.url, bindings.BROWSER, fetch, signal),
      );
      return { output: toJsonValue(result) };
    },
  });

  const searchMissingCompanyFacts = defineTool({
    name: "search_missing_company_facts",
    description:
      "Run one bounded Cloudflare AI Gateway web research pass for specific company fields that remain missing after inspecting the official website. External sources are supporting evidence and must not override conflicting official information.",
    input: v.object({
      companyName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(191)),
      domain: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(253)),
      missingFields: v.pipe(
        v.array(v.picklist(fieldNames)),
        v.minLength(1),
        v.maxLength(fieldNames.length),
      ),
    }),
    durable: true,
    async run({ data, signal, step }) {
      const uniqueFields = [...new Set<CompanyEnrichmentFieldName>(data.missingFields)];
      const result = await step.do("search-missing-facts", () =>
        runGatewaySearch(
          bindings.AI,
          `Research only these missing facts for ${JSON.stringify(data.companyName)} (${data.domain}): ${uniqueFields.join(", ")}. ` +
            "Return concise values with source URLs. Prefer official registries, the company's official social profiles, and reputable publications. " +
            "Explicitly report uncertainty and conflicts. Do not infer a value when no source states it.",
          signal,
        ),
      );
      return { output: toJsonValue(result) };
    },
  });

  return [resolveCompanyOfficialSite, inspectCompanyWebsite, searchMissingCompanyFacts] as const;
}

export async function runGatewaySearch(
  ai: Ai,
  objective: string,
  signal?: AbortSignal,
): Promise<SearchDigest> {
  signal?.throwIfAborted();
  const response = await ai.run(
    SEARCH_MODEL,
    {
      max_tokens: 2_500,
      messages: [{ role: "user", content: objective }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    },
    {
      gateway: {
        id: "default",
        skipCache: true,
        collectLog: true,
        requestTimeoutMs: 30_000,
        retries: { maxAttempts: 2, backoff: "exponential" },
      },
      ...(signal ? { signal } : {}),
    },
  );
  signal?.throwIfAborted();
  return normalizeGatewaySearchResponse(response);
}

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

export async function inspectWebsite(
  requestedUrl: string,
  browserBinding: BrowserWorker,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  launchBrowser: BrowserLauncher = (binding) => launch(binding, { keep_alive: 10_000 }),
): Promise<WebsiteInspection> {
  const startUrl = assertSafePublicHttpsUrl(requestedUrl).href;
  const warnings: string[] = [];
  const staticPages = new Map<string, InspectedPage>();
  const failedUrls = new Set<string>();

  async function fetchPage(url: string): Promise<InspectedPage | null> {
    try {
      const page = await fetchStaticPage(url, fetcher, signal);
      staticPages.set(page.url, page);
      return page;
    } catch (error) {
      failedUrls.add(url);
      warnings.push(`Static fetch failed for ${url}: ${errorMessage(error)}`);
      return null;
    }
  }

  const home = await fetchPage(startUrl);
  if (home) {
    const related = selectRelevantLinks(home.url, home.links).slice(0, MAX_PAGES - 1);
    for (const link of related) {
      signal?.throwIfAborted();
      await fetchPage(link);
    }
  }

  const sparseUrls = [...staticPages.values()]
    .filter((page) => page.text.length < 700)
    .map((page) => page.url);
  const browserTargets = [...new Set([...failedUrls, ...sparseUrls])].slice(0, MAX_BROWSER_PAGES);
  const renderedPages = new Map<string, InspectedPage>();

  if (browserTargets.length > 0) {
    const browser = await launchBrowser(browserBinding);
    try {
      const page = await browser.newPage();
      await page.route("**/*", async (route) => {
        const resourceUrl = route.request().url();
        if (resourceUrl.startsWith("data:") || resourceUrl.startsWith("blob:")) {
          await route.continue();
          return;
        }
        if (!isSafePublicHttpsUrl(resourceUrl)) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });

      for (const target of browserTargets) {
        signal?.throwIfAborted();
        try {
          const rendered = await renderPage(page, target);
          renderedPages.set(rendered.url, rendered);
        } catch (error) {
          warnings.push(`Browser rendering failed for ${target}: ${errorMessage(error)}`);
        }
      }

      if (!home && renderedPages.size > 0 && renderedPages.size < MAX_BROWSER_PAGES) {
        const renderedHome = renderedPages.values().next().value as InspectedPage | undefined;
        const moreLinks = renderedHome
          ? selectRelevantLinks(renderedHome.url, renderedHome.links)
              .filter((url) => !renderedPages.has(url))
              .slice(0, MAX_BROWSER_PAGES - renderedPages.size)
          : [];
        for (const target of moreLinks) {
          signal?.throwIfAborted();
          try {
            const rendered = await renderPage(page, target);
            renderedPages.set(rendered.url, rendered);
          } catch (error) {
            warnings.push(`Browser rendering failed for ${target}: ${errorMessage(error)}`);
          }
        }
      }
    } finally {
      await browser.close();
    }
  }

  const merged = new Map(staticPages);
  for (const page of renderedPages.values()) merged.set(page.url, page);
  const pages = capTotalText([...merged.values()].slice(0, MAX_PAGES));
  if (pages.length === 0) throw new Error("The website could not be read");
  return {
    requestedUrl: startUrl,
    pages,
    browserUsed: renderedPages.size > 0,
    warnings: warnings.slice(0, 12),
  };
}

async function fetchStaticPage(
  requestedUrl: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<InspectedPage> {
  let url = assertSafePublicHttpsUrl(requestedUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const timed = timedSignal(signal, STATIC_FETCH_TIMEOUT_MS);
    const response = await fetcher(url, {
      redirect: "manual",
      signal: timed.signal,
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
    }).finally(timed.dispose);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} had no location`);
      url = assertSafePublicHttpsUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("HTML response is too large");
    const html = await readTextLimited(response.body, MAX_RESPONSE_BYTES);
    return extractHtmlPage(url.href, html, "static");
  }
  throw new Error("Too many redirects");
}

async function renderPage(page: InspectionPage, requestedUrl: string): Promise<InspectedPage> {
  await page.goto(assertSafePublicHttpsUrl(requestedUrl).href, {
    waitUntil: "domcontentloaded",
    timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
  });
  const finalUrl = assertSafePublicHttpsUrl(page.url()).href;
  const extracted = await page.evaluate(() => {
    const meta = (selector: string) =>
      document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? "";
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((link) => ({
      url: link.href,
      text: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
    }));
    const jsonLd = [
      ...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    ]
      .map((script) => script.textContent?.trim() ?? "")
      .filter(Boolean);
    const imageCandidates = [
      meta('meta[property="og:image"]'),
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? "",
      ...[...document.querySelectorAll<HTMLImageElement>("img")]
        .filter((image) => /logo/i.test(`${image.alt} ${image.className} ${image.id}`))
        .map((image) => image.src),
    ].filter(Boolean);
    return {
      title: document.title.trim(),
      description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
      links,
      jsonLd,
      imageCandidates,
    };
  });
  return normalizePage(finalUrl, extracted, "browser");
}

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

function normalizePage(
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

function capTotalText(pages: InspectedPage[]): InspectedPage[] {
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

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
