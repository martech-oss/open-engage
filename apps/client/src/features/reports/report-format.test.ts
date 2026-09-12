import { describe, expect, it } from "vitest";

import { formatReportRate, formatReportRatio } from "./report-format";

describe("report rates", () => {
  it("distinguishes unavailable denominators from a measured zero", () => {
    expect(formatReportRate(0, 0)).toBe("—");
    expect(formatReportRate(0, 100)).toBe("0%");
    expect(formatReportRatio(0, 0)).toBe("—");
    expect(formatReportRatio(0, 10)).toBe("0%");
  });
  it("uses the actual denominator and keeps percentages in their original scale", () => {
    expect(formatReportRate(25, 4)).toBe("25%");
    expect(formatReportRatio(1, 4)).toBe("25%");
    expect(formatReportRatio(1, 3)).toBe("33.33%");
  });
});
