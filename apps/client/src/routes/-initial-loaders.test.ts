import { describe, expect, it } from "vitest";

import {
  companiesQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  companyContactOptionsQueryOptions,
  companyQueryOptions,
} from "@/features/companies/company-api";
import { emailBrandProfileQueryOptions } from "@/features/emails/email-api";

import { Route as CompanyDetailRoute } from "./_app.companies.$id";
import { Route as CompaniesRoute } from "./_app.companies.index";
import { Route as SettingsRoute } from "./_app.settings";

class PrefetchCache {
  readonly counts = new Map<string, number>();

  ensureQueryData(options: { queryKey: readonly unknown[] }): Promise<unknown> {
    const key = JSON.stringify(options.queryKey);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return Promise.resolve(undefined);
  }
}

function keyOf(options: { queryKey: readonly unknown[] }): string {
  return JSON.stringify(options.queryKey);
}

describe("initial route loaders", () => {
  it("prefetches the company list and enrichment capability once", async () => {
    const cache = new PrefetchCache();
    const loader = CompaniesRoute.options.loader as (input: unknown) => Promise<unknown>;
    await loader({
      deps: { q: "acme" },
      context: { queryClient: cache },
    } as never);

    expect(cache.counts).toEqual(
      new Map([
        [keyOf(companiesQueryOptions("acme")), 1],
        [keyOf(companyEnrichmentCapabilityQueryOptions()), 1],
      ]),
    );
  });

  it("prefetches detail, contact choices, and enrichment capability once", async () => {
    const cache = new PrefetchCache();
    const loader = CompanyDetailRoute.options.loader as (input: unknown) => Promise<unknown>;
    await loader({
      params: { id: "company-1" },
      context: { queryClient: cache },
    } as never);

    expect(cache.counts).toEqual(
      new Map([
        [keyOf(companyQueryOptions("company-1")), 1],
        [keyOf(companyContactOptionsQueryOptions()), 1],
        [keyOf(companyEnrichmentCapabilityQueryOptions()), 1],
      ]),
    );
  });

  it("prefetches the settings email brand once", async () => {
    const cache = new PrefetchCache();
    const loader = SettingsRoute.options.loader as (input: unknown) => Promise<unknown>;
    await loader({ context: { queryClient: cache } });

    expect(cache.counts).toEqual(new Map([[keyOf(emailBrandProfileQueryOptions()), 1]]));
  });
});
