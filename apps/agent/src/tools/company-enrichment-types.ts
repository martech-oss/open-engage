import type {
  BrowserContext,
  BrowserWorker,
  Page,
  Request as PlaywrightRequest,
} from "@cloudflare/playwright";

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

export type InspectionPage = Pick<Page, "goto" | "url" | "evaluate">;

export type InspectionRequest = Pick<PlaywrightRequest, "url" | "redirectedFrom">;

export interface InspectionContext {
  route: BrowserContext["route"];
  routeWebSocket: BrowserContext["routeWebSocket"];
  on(event: "request", listener: (request: InspectionRequest) => void): unknown;
  newPage(): Promise<InspectionPage>;
  close(): Promise<void>;
}

export interface InspectionBrowser {
  newContext(options: { serviceWorkers: "block" }): Promise<InspectionContext>;
  close(): Promise<void>;
}

export type BrowserLauncher = (binding: BrowserWorker) => Promise<InspectionBrowser>;
