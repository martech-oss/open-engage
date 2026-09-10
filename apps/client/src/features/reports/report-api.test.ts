import { describe, expect, it } from "vitest";

import { orpcQuery } from "@/lib/orpc";

import {
  createReportSearchDefaults,
  parseReportSearch,
  reportWorkspaceQueryOptions,
} from "./report-api";

describe("report search defaults", () => {
  it("derives the 30-day period from the dehydrated render time in the workspace timezone", () => {
    const defaults = createReportSearchDefaults({
      now: "2026-01-02T01:30:00.000Z",
      timeZone: "America/Los_Angeles",
    });

    expect(defaults).toEqual({
      view: "overview",
      from: "2025-12-03",
      to: "2026-01-01",
      currency: "",
    });
    expect(parseReportSearch({}, defaults)).toEqual(defaults);
  });
});

describe("report queries", () => {
  it("uses the generated overview query for the whole reporting workspace", () => {
    const search = {
      view: "overview" as const,
      from: "2026-01-01",
      to: "2026-01-30",
      currency: "JPY",
    };

    expect(reportWorkspaceQueryOptions(search).queryKey).toEqual(
      orpcQuery.reports.overview.queryOptions({
        input: { from: search.from, to: search.to, currency: search.currency },
      }).queryKey,
    );
  });
});

it("keeps the acquisition view and currency when parsing and querying", () => {
  const defaults = createReportSearchDefaults({ now: "2026-01-31T00:00:00.000Z", timeZone: "UTC" });
  const search = parseReportSearch({ view: "acquisition", currency: "USD" }, defaults);
  expect(search.view).toBe("acquisition");
  expect(reportWorkspaceQueryOptions(search).queryKey).toEqual(
    orpcQuery.reports.acquisition.queryOptions({
      input: { from: search.from, to: search.to, currency: "USD" },
    }).queryKey,
  );
});
