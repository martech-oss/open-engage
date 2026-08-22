import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatIsoDate,
  formatRelativeTime,
  formatShortDate,
} from "./format";

const losAngeles = { timeZone: "America/Los_Angeles" };

describe("workspace date formatting", () => {
  it("keeps a date-only value on the authored calendar date", () => {
    expect(formatShortDate("2026-01-01", losAngeles)).toBe("1/1");
    expect(formatDate("2026-01-01", losAngeles)).toBe("2026年1月1日");
  });

  it("formats timestamps in the workspace timezone", () => {
    expect(formatDateTime("2026-01-02T01:30:00.000Z", losAngeles)).toBe("2026/01/01 17:30");
  });

  it("formats relative time against the dehydrated render timestamp", () => {
    expect(
      formatRelativeTime("2026-01-02T01:27:00.000Z", {
        now: "2026-01-02T01:30:00.000Z",
      }),
    ).toBe("3分前");
  });
});

describe("formatIsoDate", () => {
  it("returns the UTC calendar date used by report query inputs", () => {
    expect(formatIsoDate(new Date("2026-08-20T23:30:00-07:00"))).toBe("2026-08-21");
  });

  it("returns the workspace calendar date when a timezone is supplied", () => {
    expect(formatIsoDate(new Date("2026-01-02T01:30:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-01-01",
    );
  });
});
