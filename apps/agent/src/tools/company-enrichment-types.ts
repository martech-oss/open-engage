import type { BrowserWorker, Page } from "@cloudflare/playwright";

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
