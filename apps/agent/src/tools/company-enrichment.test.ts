import type { BrowserWorker } from "@cloudflare/playwright";
import { describe, expect, it, vi } from "vitest";

import {
  assertSafePublicHttpsUrl,
  extractHtmlPage,
  inspectWebsite,
  normalizeGatewaySearchResponse,
  selectRelevantLinks,
  type BrowserLauncher,
  type InspectionBrowser,
  type InspectionContext,
  type InspectionPage,
  type InspectionRequest,
} from "./company-enrichment";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn<() => Promise<never>>() }));

const browserBinding = { fetch: vi.fn<typeof fetch>() } satisfies BrowserWorker;

/** A browser whose single context hands out `page` and reports the requests it is told to. */
function browserWith(
  page: InspectionPage,
  requests: (target: string) => InspectionRequest[] = () => [],
) {
  const listeners: Array<(request: InspectionRequest) => void> = [];
  const context = {
    route: vi.fn<InspectionContext["route"]>().mockResolvedValue(undefined),
    routeWebSocket: vi.fn<InspectionContext["routeWebSocket"]>().mockResolvedValue(undefined),
    on: vi.fn<InspectionContext["on"]>().mockImplementation((_event, listener) => {
      listeners.push(listener);
    }),
    newPage: vi.fn<InspectionContext["newPage"]>().mockResolvedValue({
      ...page,
      goto: async (url, options) => {
        for (const request of requests(url)) for (const listener of listeners) listener(request);
        return page.goto(url, options);
      },
    }),
    close: vi.fn<InspectionContext["close"]>().mockResolvedValue(undefined),
  } satisfies InspectionContext;
  const browser = {
    newContext: vi.fn<InspectionBrowser["newContext"]>().mockResolvedValue(context),
    close: vi.fn<InspectionBrowser["close"]>().mockResolvedValue(undefined),
  } satisfies InspectionBrowser;
  return { browser, context };
}

function renderedPage(title = "Example"): InspectionPage {
  return {
    goto: vi.fn<InspectionPage["goto"]>().mockResolvedValue(null),
    url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
    evaluate: vi.fn<InspectionPage["evaluate"]>().mockResolvedValue({
      title,
      description: "Description",
      text: "Rendered company information ".repeat(60),
      links: [],
      jsonLd: [],
      imageCandidates: [],
    }),
  };
}

describe("company enrichment URL safety", () => {
  it.each([
    "http://example.com",
    "https://localhost/path",
    "https://127.0.0.1/path",
    "https://10.0.0.1/path",
    "https://172.20.0.1/path",
    "https://192.168.1.1/path",
    "https://user:password@example.com/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fd12:3456:789a::1]/",
    "https://[fe80::1]/",
    "https://0177.0.0.1/",
    "https://0x7f.0.0.1/",
    "https://2130706433/",
    "https://%31%32%37.0.0.1/",
  ])("blocks unsafe URL %s", (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow();
  });

  it("accepts a public HTTPS URL", () => {
    expect(assertSafePublicHttpsUrl("https://example.com/about").href).toBe(
      "https://example.com/about",
    );
  });

  it.each([
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[0:0:0:0:0:ffff:0a00:0001]/",
    "https://[::ffff:172.16.0.1]/",
    "https://[::ffff:192.168.0.1]/",
    "https://[::ffff:169.254.1.1]/",
    "https://[::ffff:100.64.0.1]/",
    "https://[::ffff:198.18.0.1]/",
    "https://[::ffff:224.0.0.1]/",
    "https://[::ffff:0.0.0.0]/",
  ])("blocks an IPv4-mapped private or local address %s", (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow("Private or local hostname");
  });

  it.each([
    ["public hostname", "https://example.com/"],
    ["public IPv4", "https://8.8.8.8/"],
    ["public IPv6", "https://[2001:4860:4860::8888]/"],
    ["public IPv4-mapped IPv6", "https://[::ffff:8.8.8.8]/"],
    ["public 192.0.1.1 IPv4", "https://192.0.1.1/"],
    ["public 192.0.1.1 IPv4-mapped IPv6", "https://[::ffff:192.0.1.1]/"],
    ["globally reachable PCP anycast IPv4", "https://192.0.0.9/"],
    ["globally reachable PCP anycast IPv4-mapped IPv6", "https://[::ffff:192.0.0.9]/"],
    ["globally reachable TURN anycast IPv4", "https://192.0.0.10/"],
    ["globally reachable TURN anycast IPv4-mapped IPv6", "https://[::ffff:192.0.0.10]/"],
  ])("accepts a %s control", (_kind, url) => {
    expect(assertSafePublicHttpsUrl(url).href).toBe(new URL(url).href);
  });
});

describe("normalizeGatewaySearchResponse", () => {
  it("extracts bounded answer text and public citations", () => {
    const result = normalizeGatewaySearchResponse({
      content: [
        { type: "text", text: "The official website is Example." },
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", url: "https://example.com/", title: "Example" },
            { type: "web_search_result", url: "https://127.0.0.1/", title: "Private" },
          ],
        },
      ],
    });

    expect(result.answer).toContain("official website");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ url: "https://example.com/", title: "Example" });
  });
});

describe("HTML inspection", () => {
  it("extracts metadata and selects company-relevant links", () => {
    const page = extractHtmlPage(
      "https://example.com/",
      `<html><head><title>Example Inc.</title><meta name="description" content="Company description"></head>
       <body><a href="/about">会社概要</a><a href="/privacy">Privacy</a><p>Example content</p></body></html>`,
    );
    expect(page).toMatchObject({ title: "Example Inc.", description: "Company description" });
    expect(selectRelevantLinks(page.url, page.links)).toEqual(["https://example.com/about"]);
  });

  it("uses bounded static fetches without launching a browser when HTML is sufficient", async () => {
    const paragraph = "Public company information ".repeat(60);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const link = url.pathname === "/" ? '<a href="/about">About company</a>' : "";
      return new Response(`<html><title>Example</title><body>${link}${paragraph}</body></html>`, {
        headers: { "content-type": "text/html" },
      });
    });
    const launchBrowser = vi.fn<BrowserLauncher>();

    const result = await inspectWebsite(
      "https://example.com/",
      browserBinding,
      fetcher,
      undefined,
      launchBrowser,
    );

    expect(result.browserUsed).toBe(false);
    expect(result.pages).toHaveLength(2);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("closes Playwright after rendering succeeds", async () => {
    const { browser, context } = browserWith(renderedPage());
    const launchBrowser = vi.fn<BrowserLauncher>().mockResolvedValue(browser);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    const result = await inspectWebsite(
      "https://example.com/",
      browserBinding,
      fetcher,
      undefined,
      launchBrowser,
    );

    expect(result.browserUsed).toBe(true);
    expect(browser.close).toHaveBeenCalledOnce();
    // Policy applies to the whole context, with Service Workers refused.
    expect(browser.newContext).toHaveBeenCalledWith({ serviceWorkers: "block" });
    expect(context.route).toHaveBeenCalledOnce();
    expect(context.routeWebSocket).toHaveBeenCalledOnce();
  });

  it("discards a rendered page whose redirect chain reached a disallowed address", async () => {
    const page = renderedPage();
    const { browser } = browserWith(page, (target) =>
      target === "https://example.com/"
        ? [{ url: () => "https://10.0.0.5/admin", redirectedFrom: () => ({}) as never }]
        : [],
    );
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    await expect(
      inspectWebsite(
        "https://example.com/",
        browserBinding,
        fetcher,
        undefined,
        vi.fn<BrowserLauncher>().mockResolvedValue(browser),
      ),
    ).rejects.toThrow("could not be read");
    expect(page.evaluate).toHaveBeenCalled();
  });

  it("keeps a page whose only redirects stay on public HTTPS addresses", async () => {
    const { browser } = browserWith(renderedPage(), () => [
      { url: () => "https://www.example.com/", redirectedFrom: () => ({}) as never },
      { url: () => "http://10.0.0.5/direct", redirectedFrom: () => null },
    ]);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    const result = await inspectWebsite(
      "https://example.com/",
      browserBinding,
      fetcher,
      undefined,
      vi.fn<BrowserLauncher>().mockResolvedValue(browser),
    );
    expect(result.browserUsed).toBe(true);
  });

  it("prefers rendered content over a sparse static copy of the same page", async () => {
    const page = {
      goto: vi.fn<InspectionPage["goto"]>().mockResolvedValue(null),
      url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
      evaluate: vi.fn<InspectionPage["evaluate"]>().mockResolvedValue({
        title: "Rendered Example",
        description: "Rendered description",
        text: "Rendered company information ".repeat(60),
        links: [],
        jsonLd: [],
        imageCandidates: [],
      }),
    } satisfies InspectionPage;
    const { browser } = browserWith(page);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html><title>Static Example</title><body>Too sparse</body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await inspectWebsite(
      "https://example.com/",
      browserBinding,
      fetcher,
      undefined,
      vi.fn<BrowserLauncher>().mockResolvedValue(browser),
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({
      mode: "browser",
      title: "Rendered Example",
      description: "Rendered description",
    });
  });

  it("closes Playwright when rendering fails", async () => {
    const failedPage = {
      goto: vi.fn<InspectionPage["goto"]>().mockRejectedValue(new Error("navigation failed")),
      url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
      evaluate: vi.fn<InspectionPage["evaluate"]>(),
    } satisfies InspectionPage;
    const { browser } = browserWith(failedPage);
    const launchBrowser = vi.fn<BrowserLauncher>().mockResolvedValue(browser);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    await expect(
      inspectWebsite("https://example.com/", browserBinding, fetcher, undefined, launchBrowser),
    ).rejects.toThrow("could not be read");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("abandons a static page whose body stalls past the caller's cancellation", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode("<html><title>Slow</title>"));
            // Headers arrived; the rest of the body never does.
          },
          cancel: () => {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    );
    const { browser } = browserWith(renderedPage());
    setTimeout(() => controller.abort(new Error("caller gave up")), 20);

    await expect(
      inspectWebsite(
        "https://example.com/",
        browserBinding,
        fetcher,
        controller.signal,
        vi.fn<BrowserLauncher>().mockResolvedValue(browser),
      ),
    ).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
});
