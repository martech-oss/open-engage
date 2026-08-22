import { describe, expect, it } from "vitest";

import {
  contactTrendQueryOptions,
  dealSummaryQueryOptions,
  deliveryTrendQueryOptions,
} from "./dashboard-api";

function queryInput(options: { queryKey: readonly unknown[] }): unknown {
  return options.queryKey.at(-1);
}

describe("dashboard query ranges", () => {
  it("derives trend inputs from the dehydrated render time and workspace timezone", () => {
    const clock = {
      now: "2026-01-02T01:30:00.000Z",
      timeZone: "America/Los_Angeles",
    };

    expect(queryInput(deliveryTrendQueryOptions(clock))).toMatchObject({
      input: { from: "2025-12-19", to: "2026-01-01" },
    });
    expect(queryInput(contactTrendQueryOptions(clock))).toMatchObject({
      input: { from: "2025-12-19", to: "2026-01-01" },
    });
    expect(queryInput(dealSummaryQueryOptions(clock))).toMatchObject({
      input: { from: "2025-12-03", to: "2026-01-01" },
    });
  });
});
