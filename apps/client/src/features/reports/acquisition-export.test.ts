import { expect, it } from "vitest";

import type { AcquisitionReport } from "@openengage/core/reports";

import { reportExport } from "./report-export";

it("exports acquisition dimensions, period and currency alongside outcomes", () => {
  const metrics = {
    pageViews: 5,
    visitors: 2,
    submissions: 1,
    submittingContacts: 1,
    mql: 1,
    dealsCreated: 1,
    won: 1,
    wonValue: 200,
  };
  const report: AcquisitionReport = {
    category: "acquisition",
    range: { from: "2026-01-01", to: "2026-01-31" },
    currency: "JPY",
    attributionModel: "first_retained_touch",
    summary: metrics,
    sources: [
      { channel: "paid_search", source: "google", medium: "cpc", campaign: "autumn", ...metrics },
    ],
  };
  const exported = reportExport({ view: "acquisition", acquisition: report });
  expect(exported?.filename).toBe("acquisition-report.csv");
  expect(exported?.rows[0]).toMatchObject({
    source: "google",
    campaign: "autumn",
    currency: "JPY",
    won_value: 200,
    from: "2026-01-01",
    to: "2026-01-31",
  });
});
