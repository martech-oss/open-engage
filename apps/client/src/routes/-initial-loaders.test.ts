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
  it("redirects legacy brief URLs to canonical project routes with their filters", async () => {
    const detail = await import("./_app.automations.briefs.$id");
    const list = await import("./_app.automations.briefs.index");
    const beforeDetail = detail.Route.options.beforeLoad as (input: unknown) => unknown;
    const beforeList = list.Route.options.beforeLoad as (input: unknown) => unknown;
    await expect(
      Promise.resolve().then(() => beforeDetail({ params: { id: "project-1" } })),
    ).rejects.toMatchObject({
      options: { to: "/projects/$id", params: { id: "project-1" }, replace: true },
    });
    await expect(
      Promise.resolve().then(() =>
        beforeList({ search: { status: "approved", owner: "owner-1", overdue: true } }),
      ),
    ).rejects.toMatchObject({
      options: {
        to: "/projects",
        search: { status: "approved", owner: "owner-1", overdue: true, view: "briefs" },
        replace: true,
      },
    });
  });
  it("prefetches the company list and enrichment capability once", async () => {
    const cache = new PrefetchCache();
    const loader = CompaniesRoute.options.loader as (input: unknown) => Promise<unknown>;
    const result = await loader({
      deps: { q: "acme" },
      context: { queryClient: cache },
    } as never);

    expect(result).toBeUndefined();

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
    const result = await loader({
      params: { id: "company-1" },
      context: { queryClient: cache },
    } as never);

    expect(result).toBeUndefined();

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
    const result = await loader({ context: { queryClient: cache } });

    expect(result).toBeUndefined();

    expect(cache.counts).toEqual(new Map([[keyOf(emailBrandProfileQueryOptions()), 1]]));
  });

  const preloadOnlyRoutes = [
    ["automation detail", () => import("./_app.automations.$id")],
    ["project detail", () => import("./_app.projects.$id")],
    ["projects", () => import("./_app.projects.index")],
    ["automations", () => import("./_app.automations.index")],
    ["company detail", () => import("./_app.companies.$id")],
    ["companies", () => import("./_app.companies.index")],
    ["contacts", () => import("./_app.contacts.index")],
    ["dashboard", () => import("./_app.dashboard")],
    ["deal detail", () => import("./_app.deals.$id")],
    ["deals", () => import("./_app.deals.index")],
    ["email archive", () => import("./_app.emails.archive")],
    ["email templates", () => import("./_app.emails.templates")],
    ["email tracking", () => import("./_app.emails.tracking")],
    ["email variables", () => import("./_app.emails.variables")],
    ["list detail", () => import("./_app.lists.$id"), { kind: "static" }],
    ["lists", () => import("./_app.lists.index")],
    ["deal reports", () => import("./_app.deal-reports")],
    ["reports", () => import("./_app.reports")],
    ["grading", () => import("./_app.scoring.grading")],
    ["scoring rules", () => import("./_app.scoring.rules")],
    ["segment detail", () => import("./_app.segments.$id"), { kind: "dynamic" }],
    ["segments", () => import("./_app.segments.index")],
    ["settings", () => import("./_app.settings")],
    ["tags", () => import("./_app.tags")],
    ["tasks", () => import("./_app.tasks")],
    ["site messages", () => import("./_app.website.messages")],
    ["redirects", () => import("./_app.website.redirects")],
    ["site tracking", () => import("./_app.website.tracking")],
  ] as const;

  for (const [name, loadRoute, firstResult] of preloadOnlyRoutes) {
    it(`${name} warms query data without returning loader data`, async () => {
      const { Route } = await loadRoute();
      let calls = 0;
      const loader = Route.options.loader as (input: unknown) => Promise<unknown>;
      const result = await loader({
        params: { id: "resource-1" },
        deps: {
          q: "",
          page: 1,
          limit: 50,
          status: "all",
          stage: "",
          tagId: "",
          companyId: "",
          segmentId: "",
          scoreMin: "",
          scoreMax: "",
          sort: "updatedAt",
          direction: "desc",
        },
        context: {
          queryClient: {
            ensureQueryData: async () => {
              calls += 1;
              return calls === 1 ? firstResult : undefined;
            },
          },
          reportSearch: {
            view: "overview",
            from: "2026-08-01",
            to: "2026-08-26",
            currency: "USD",
          },
          dealReportSearch: {
            from: "2026-08-01",
            to: "2026-08-26",
            currency: "USD",
          },
        },
      } as never);

      expect(result).toBeUndefined();
      expect(calls).toBeGreaterThan(0);
    });
  }
});
