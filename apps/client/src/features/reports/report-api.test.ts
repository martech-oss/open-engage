import { describe, expect, it } from "vitest";

import { createReportSearchDefaults, parseReportSearch } from "./report-api";

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
