import type { BrowserWorker, Frame, Route } from "@cloudflare/playwright";
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
} from "./company-enrichment";
import { BrowserRequestPolicy } from "./company-enrichment-browser";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn<() => Promise<never>>() }));

const browserBinding = { fetch: vi.fn<typeof fetch>() } satisfies BrowserWorker;
const mainFrame = {} as Frame;

interface FakeRequest {
  url: string;
  resourceType?: string;
  frame?: Frame | null;
  navigation?: boolean;
  status?: number;
  location?: string;
  fetchError?: Error;
}

/** A Playwright route over one request, recording what the policy did with it. */
function fakeRoute(input: FakeRequest) {
  const calls = {
    fetch: vi.fn<(options: unknown) => void>(),
    fulfill: vi.fn<() => void>(),
    abort: vi.fn<(code?: string) => void>(),
    continue: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
  };
  const route = {
    request: () => ({
      url: () => input.url,
      resourceType: () => input.resourceType ?? "document",
      isNavigationRequest: () => input.navigation ?? true,
      frame: () => input.frame ?? mainFrame,
    }),
    fetch: async (options: unknown) => {
      calls.fetch(options);
      if (input.fetchError) throw input.fetchError;
      return {
        status: () => input.status ?? 200,
        headers: () => (input.location ? { location: input.location } : {}),
        dispose: async () => calls.dispose(),
      };
    },
    fulfill: async () => calls.fulfill(),
    abort: async (code?: string) => calls.abort(code),
    continue: async () => calls.continue(),
  } as unknown as Route;
  return { route, calls };
}

/**
 * A browser whose page navigations go through the context's route handler,
 * answered from `site` (200 unless listed), as the real browser would.
 */
function browserWith(
  page: InspectionPage,
  site: Record<string, { status: number; location?: string }> = {},
) {
  let handler: ((route: Route) => Promise<void>) | undefined;
  const fetched: string[] = [];
  let current = "";
  const context = {
    route: vi.fn<InspectionContext["route"]>().mockImplementation(async (_url, routeHandler) => {
      handler = routeHandler as (route: Route) => Promise<void>;
    }),
    routeWebSocket: vi.fn<InspectionContext["routeWebSocket"]>().mockResolvedValue(undefined),
    newPage: vi.fn<InspectionContext["newPage"]>().mockResolvedValue({
      ...page,
      mainFrame: () => mainFrame,
      url: () => current,
      goto: async (url, options) => {
        const { route, calls } = fakeRoute({ url, ...site[url] });
        calls.fetch.mockImplementation(() => fetched.push(url));
        await handler?.(route);
        if (calls.abort.mock.calls.length > 0) throw new Error("net::ERR_BLOCKED_BY_CLIENT");
        current = url;
        return page.goto(url, options);
      },
    }),
    close: vi.fn<InspectionContext["close"]>().mockResolvedValue(undefined),
  } satisfies InspectionContext;
  const browser = {
    newContext: vi.fn<InspectionBrowser["newContext"]>().mockResolvedValue(context),
    close: vi.fn<InspectionBrowser["close"]>().mockResolvedValue(undefined),
  } satisfies InspectionBrowser;
  return { browser, context, fetched };
}

function renderedPage(title = "Example"): InspectionPage {
  return {
    goto: vi.fn<InspectionPage["goto"]>().mockResolvedValue(null),
    url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
    mainFrame: vi.fn<InspectionPage["mainFrame"]>().mockReturnValue(mainFrame),
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

describe("browser request policy", () => {
  it("relays requests from the Worker with redirects disabled", async () => {
    const { route, calls } = fakeRoute({
      url: "https://example.com/app.js",
      resourceType: "script",
    });
    await new BrowserRequestPolicy().handle(route);
    expect(calls.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 10_000 });
    expect(calls.fulfill).toHaveBeenCalledOnce();
  });

  it.each([
    { url: "https://example.com/logo.png", resourceType: "image" },
    { url: "https://example.com/font.woff2", resourceType: "font" },
    { url: "https://10.0.0.5/internal", resourceType: "xhr" },
    { url: "http://example.com/plain", resourceType: "document" },
  ])("refuses $url ($resourceType) without fetching it", async (request) => {
    const { route, calls } = fakeRoute(request);
    await new BrowserRequestPolicy().handle(route);
    expect(calls.fetch).not.toHaveBeenCalled();
    expect(calls.abort).toHaveBeenCalledWith("blockedbyclient");
  });

  it("lets inline data URLs through without a request", async () => {
    const { route, calls } = fakeRoute({ url: "data:text/plain,hi" });
    await new BrowserRequestPolicy().handle(route);
    expect(calls.continue).toHaveBeenCalledOnce();
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/about", "https://example.com/about", true],
    ["https://10.0.0.5/admin", "https://10.0.0.5/admin", false],
    ["http://example.com/", "http://example.com/", false],
  ])(
    "ends a page redirect to %s and reports it for the caller to follow",
    async (location, url, allowed) => {
      const policy = new BrowserRequestPolicy();
      policy.watch(mainFrame);
      const { route, calls } = fakeRoute({ url: "https://example.com/", status: 302, location });
      await policy.handle(route);
      expect(calls.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(calls.fetch).toHaveBeenCalledOnce();
      expect(calls.dispose).toHaveBeenCalledOnce();
      expect(policy.takeRedirect()).toEqual({ url, allowed });
      expect(policy.takeRedirect()).toBeNull();
    },
  );

  it("drops redirects of sub-resources and frames without reporting them", async () => {
    const policy = new BrowserRequestPolicy();
    policy.watch(mainFrame);
    for (const request of [
      { url: "https://example.com/app.js", resourceType: "script", navigation: false },
      { url: "https://example.com/embed", frame: {} as Frame },
    ]) {
      const { route, calls } = fakeRoute({ ...request, status: 301, location: "/elsewhere" });
      await policy.handle(route);
      expect(calls.abort).toHaveBeenCalledWith("blockedbyclient");
    }
    expect(policy.takeRedirect()).toBeNull();
  });

  it("fails a request the Worker could not fetch", async () => {
    const { route, calls } = fakeRoute({
      url: "https://example.com/",
      fetchError: new Error("connection reset"),
    });
    await new BrowserRequestPolicy().handle(route);
    expect(calls.abort).toHaveBeenCalledWith("failed");
  });
});

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

  it("follows a page redirect itself after validating the target", async () => {
    const { browser, fetched } = browserWith(renderedPage(), {
      "https://example.com/": { status: 301, location: "https://www.example.com/" },
    });
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    const result = await inspectWebsite(
      "https://example.com/",
      browserBinding,
      fetcher,
      undefined,
      vi.fn<BrowserLauncher>().mockResolvedValue(browser),
    );
    expect(result.pages[0]?.url).toBe("https://www.example.com/");
    expect(fetched).toEqual(["https://example.com/", "https://www.example.com/"]);
  });

  it("never contacts a disallowed redirect target", async () => {
    const page = renderedPage();
    const { browser, fetched } = browserWith(page, {
      "https://example.com/": { status: 302, location: "https://10.0.0.5/admin" },
    });
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
    expect(fetched).toEqual(["https://example.com/"]);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("stops after a bounded number of redirects", async () => {
    const site = Object.fromEntries(
      Array.from({ length: 8 }, (_, hop) => [
        `https://example.com/${hop}`,
        { status: 302, location: `https://example.com/${hop + 1}` },
      ]),
    );
    const { browser, fetched } = browserWith(renderedPage(), site);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    await expect(
      inspectWebsite(
        "https://example.com/0",
        browserBinding,
        fetcher,
        undefined,
        vi.fn<BrowserLauncher>().mockResolvedValue(browser),
      ),
    ).rejects.toThrow("could not be read");
    expect(fetched).toHaveLength(6);
  });

  it("prefers rendered content over a sparse static copy of the same page", async () => {
    const page = {
      goto: vi.fn<InspectionPage["goto"]>().mockResolvedValue(null),
      url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
      mainFrame: vi.fn<InspectionPage["mainFrame"]>().mockReturnValue(mainFrame),
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
      mainFrame: vi.fn<InspectionPage["mainFrame"]>().mockReturnValue(mainFrame),
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
