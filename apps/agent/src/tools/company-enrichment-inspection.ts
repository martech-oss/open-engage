import { launch, type BrowserWorker } from "@cloudflare/playwright";

import { extractHtmlPage, selectRelevantLinks } from "./company-enrichment-html";
import { capTotalText, normalizePage } from "./company-enrichment-normalization";
import type {
  BrowserLauncher,
  InspectedPage,
  InspectionPage,
  WebsiteInspection,
} from "./company-enrichment-types";
import {
  assertSafePublicHttpsUrl,
  errorMessage,
  isSafePublicHttpsUrl,
  readTextLimited,
  timedSignal,
} from "./company-enrichment-web";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PAGES = 4;
const MAX_BROWSER_PAGES = 3;
const STATIC_FETCH_TIMEOUT_MS = 12_000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000;

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
