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
  type InspectionPage,
} from "./company-enrichment";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn<() => Promise<never>>() }));

const browserBinding = { fetch: vi.fn<typeof fetch>() } satisfies BrowserWorker;

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
  ])("blocks unsafe URL %s", (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow();
  });

  it("accepts a public HTTPS URL", () => {
    expect(assertSafePublicHttpsUrl("https://example.com/about").href).toBe(
      "https://example.com/about",
    );
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
    const close = vi.fn<InspectionBrowser["close"]>().mockResolvedValue(undefined);
    const page = {
      route: vi.fn<InspectionPage["route"]>().mockResolvedValue(undefined),
      goto: vi.fn<InspectionPage["goto"]>().mockResolvedValue(null),
      url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
      evaluate: vi.fn<InspectionPage["evaluate"]>().mockResolvedValue({
        title: "Example",
        description: "Description",
        text: "Rendered company information ".repeat(60),
        links: [],
        jsonLd: [],
        imageCandidates: [],
      }),
    } satisfies InspectionPage;
    const browser = {
      newPage: vi.fn<InspectionBrowser["newPage"]>().mockResolvedValue(page),
      close,
    } satisfies InspectionBrowser;
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
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes Playwright when rendering fails", async () => {
    const close = vi.fn<InspectionBrowser["close"]>().mockResolvedValue(undefined);
    const failedPage = {
      route: vi.fn<InspectionPage["route"]>().mockResolvedValue(undefined),
      goto: vi.fn<InspectionPage["goto"]>().mockRejectedValue(new Error("navigation failed")),
      url: vi.fn<InspectionPage["url"]>().mockReturnValue("https://example.com/"),
      evaluate: vi.fn<InspectionPage["evaluate"]>(),
    } satisfies InspectionPage;
    const browser = {
      newPage: vi.fn<InspectionBrowser["newPage"]>().mockResolvedValue(failedPage),
      close,
    } satisfies InspectionBrowser;
    const launchBrowser = vi.fn<BrowserLauncher>().mockResolvedValue(browser);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("static unavailable"));

    await expect(
      inspectWebsite("https://example.com/", browserBinding, fetcher, undefined, launchBrowser),
    ).rejects.toThrow("could not be read");
    expect(close).toHaveBeenCalledOnce();
  });
});
