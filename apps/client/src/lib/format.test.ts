import { describe, expect, it } from "vitest";

import { formatIsoDate } from "./format";

describe("formatIsoDate", () => {
  it("returns the UTC calendar date used by report query inputs", () => {
    expect(formatIsoDate(new Date("2026-08-20T23:30:00-07:00"))).toBe("2026-08-21");
  });
});
