import { defineTool, type JsonValue } from "@flue/runtime";
import * as v from "valibot";

import {
  companyEnrichmentFieldNameSchema,
  type CompanyEnrichmentFieldName,
} from "@openengage/core/contacts";

import { inspectWebsite } from "./company-enrichment-inspection";
import { runGatewaySearch } from "./company-enrichment-search";
import type { CompanyEnrichmentToolBindings } from "./company-enrichment-types";

export { extractHtmlPage, selectRelevantLinks } from "./company-enrichment-html";
export { inspectWebsite } from "./company-enrichment-inspection";
export { normalizeGatewaySearchResponse } from "./company-enrichment-normalization";
export type {
  BrowserLauncher,
  CompanyEnrichmentToolBindings,
  InspectionBrowser,
  InspectionPage,
} from "./company-enrichment-types";
export { assertSafePublicHttpsUrl } from "./company-enrichment-web";

const fieldNames = companyEnrichmentFieldNameSchema.options;

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

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
