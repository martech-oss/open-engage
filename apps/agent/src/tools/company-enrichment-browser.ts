import type { Frame, Request, Route } from "@cloudflare/playwright";

import { isSafePublicHttpsUrl } from "./company-enrichment-web";

/** Text extraction needs documents, scripts, styles and data requests only. */
const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const RESOURCE_TIMEOUT_MS = 10_000;

export type InspectionRoute = Pick<Route, "request" | "fetch" | "fulfill" | "abort" | "continue">;

export interface BrowserRedirect {
  url: string;
  allowed: boolean;
}

/**
 * The rendering browser never contacts a site itself. Every request is
 * re-issued from the Worker with redirects disabled and only the final answer
 * is handed back, because Playwright follows a redirect hop without consulting
 * a route handler. A redirect therefore ends the request: for the page's own
 * navigation its target is validated before anything connects to it, and
 * reported so the caller can navigate there itself.
 */
export class BrowserRequestPolicy {
  private mainFrame: Frame | null = null;
  private redirect: BrowserRedirect | null = null;

  /** Only navigations of this frame report a redirect; sub-frames just stop. */
  public watch(mainFrame: Frame): void {
    this.mainFrame = mainFrame;
  }

  public takeRedirect(): BrowserRedirect | null {
    const redirect = this.redirect;
    this.redirect = null;
    return redirect;
  }

  public readonly handle = async (route: InspectionRoute): Promise<void> => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return await route.continue();
    if (SKIPPED_RESOURCE_TYPES.has(request.resourceType()) || !isSafePublicHttpsUrl(url))
      return await route.abort("blockedbyclient");
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0, timeout: RESOURCE_TIMEOUT_MS });
    } catch {
      return await route.abort("failed");
    }
    const status = response.status();
    if (status < 300 || status >= 400) return await route.fulfill({ response });
    const location = response.headers()["location"];
    await response.dispose();
    if (location && this.isMainNavigation(request)) {
      const target = URL.parse(location, url)?.href ?? location;
      this.redirect = { url: target, allowed: isSafePublicHttpsUrl(target) };
    }
    await route.abort("blockedbyclient");
  };

  private isMainNavigation(request: Request): boolean {
    try {
      return request.isNavigationRequest() && request.frame() === this.mainFrame;
    } catch {
      // Requests without a frame (workers) are never the page's navigation.
      return false;
    }
  }
}
