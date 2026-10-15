import { launch, type BrowserWorker } from "@cloudflare/playwright";

import { BrowserRequestPolicy } from "./company-enrichment-browser";
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
  readTextLimited,
  timedSignal,
} from "./company-enrichment-web";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PAGES = 4;
const MAX_BROWSER_PAGES = 3;
const STATIC_FETCH_TIMEOUT_MS = 12_000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000;
const MAX_BROWSER_REDIRECTS = 5;

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
      // A Service Worker's own requests never reach the route handler below.
      const context = await browser.newContext({ serviceWorkers: "block" });
      const policy = new BrowserRequestPolicy();
      // Routing the whole context also covers any pop-up the page opens.
      await context.route("**/*", policy.handle);
      // WebSockets cannot be relayed through the Worker, so none are opened.
      await context.routeWebSocket(
        () => true,
        (socket) => socket.close(),
      );
      const page = await context.newPage();
      policy.watch(page.mainFrame());
      const render = (target: string) => renderPage(page, policy, target);

      for (const target of browserTargets) {
        signal?.throwIfAborted();
        try {
          const rendered = await render(target);
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
            const rendered = await render(target);
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
    // The deadline and the caller's cancellation cover the body as well as
    // the headers, and every exit releases the response stream.
    const timed = timedSignal(signal, STATIC_FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(url, {
        redirect: "manual",
        signal: timed.signal,
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
      });
      if (response.status >= 300 && response.status < 400) {
        await discardBody(response);
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect ${response.status} had no location`);
        url = assertSafePublicHttpsUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await discardBody(response);
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        await discardBody(response);
        throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
      }
      if (declaredLength > MAX_RESPONSE_BYTES) {
        await discardBody(response);
        throw new Error("HTML response is too large");
      }
      const html = await readTextLimited(response.body, MAX_RESPONSE_BYTES, timed.signal);
      return extractHtmlPage(url.href, html, "static");
    } finally {
      timed.dispose();
    }
  }
  throw new Error("Too many redirects");
}

async function renderPage(
  page: InspectionPage,
  policy: BrowserRequestPolicy,
  requestedUrl: string,
): Promise<InspectedPage> {
  let target = assertSafePublicHttpsUrl(requestedUrl).href;
  for (let redirects = 0; ; redirects += 1) {
    policy.takeRedirect();
    let navigationError: unknown = null;
    try {
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      // A redirect ends the navigation with a blocked request.
      navigationError = error;
    }
    const redirect = policy.takeRedirect();
    if (!redirect) {
      if (navigationError) throw navigationError;
      break;
    }
    if (!redirect.allowed) throw new Error(`Redirected to a disallowed address: ${redirect.url}`);
    if (redirects >= MAX_BROWSER_REDIRECTS) throw new Error("Too many redirects");
    target = redirect.url;
  }
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

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
