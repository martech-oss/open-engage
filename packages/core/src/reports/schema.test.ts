import { describe, expect, it } from "vitest";

import { reportCategorySchema, reportDateRangeSchema, reportQuerySchema } from "./schema";

describe("report schemas", () => {
  it("supports the six reporting domains", () => {
    expect(reportCategorySchema.options).toEqual([
      "contacts",
      "automations",
      "emails",
      "deals",
      "site",
      "campaigns",
    ]);
  });

  it("accepts an inclusive range of up to 366 days", () => {
    expect(reportDateRangeSchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(
      true,
    );
  });

  it("rejects reversed and excessively long ranges", () => {
    expect(reportDateRangeSchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(
      false,
    );
    expect(reportDateRangeSchema.safeParse({ from: "2025-01-01", to: "2026-12-31" }).success).toBe(
      false,
    );
  });

  it("normalizes an optional deal currency", () => {
    expect(
      reportQuerySchema.parse({ from: "2026-01-01", to: "2026-01-31", currency: "jpy" }),
    ).toMatchObject({ currency: "JPY" });
  });
});
