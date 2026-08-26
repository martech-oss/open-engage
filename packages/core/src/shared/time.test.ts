import { describe, expect, it } from "vitest";

import {
  type WorkspaceDateTimeError,
  workspaceDateTimeToUtc,
  workspaceReportDateRange,
} from "./time";

describe("workspaceDateTimeToUtc", () => {
  it.each([
    ["Asia/Tokyo", "2026-08-23T09:15", "2026-08-23T00:15:00.000Z"],
    ["America/Los_Angeles", "2026-08-22T17:15", "2026-08-23T00:15:00.000Z"],
  ])(
    "interprets %s wall time independently of the browser timezone",
    (timeZone, value, expected) => {
      expect(workspaceDateTimeToUtc(value, timeZone)).toBe(expected);
    },
  );

  it("chooses the earlier instant for an ambiguous fall-back wall time", () => {
    expect(workspaceDateTimeToUtc("2026-11-01T01:30", "America/Los_Angeles")).toBe(
      "2026-11-01T08:30:00.000Z",
    );
  });

  it("rejects a nonexistent spring-forward wall time", () => {
    expect(() => workspaceDateTimeToUtc("2026-03-08T02:30", "America/Los_Angeles")).toThrowError(
      expect.objectContaining<Partial<WorkspaceDateTimeError>>({
        code: "nonexistent",
        value: "2026-03-08T02:30",
        timeZone: "America/Los_Angeles",
      }),
    );
  });
});

describe("workspaceReportDateRange", () => {
  it("builds Tokyo day boundaries and labelled database buckets", () => {
    expect(workspaceReportDateRange("2026-08-23", "2026-08-23", "Asia/Tokyo")).toEqual({
      from: "2026-08-23",
      to: "2026-08-23",
      fromTimestamp: "2026-08-22T15:00:00.000Z",
      toExclusiveTimestamp: "2026-08-23T15:00:00.000Z",
      days: [
        {
          day: "2026-08-23",
          fromTimestamp: "2026-08-22T15:00:00.000Z",
          toExclusiveTimestamp: "2026-08-23T15:00:00.000Z",
        },
      ],
    });
  });

  it("uses a 23-hour bucket across Los Angeles spring-forward", () => {
    expect(
      workspaceReportDateRange("2026-03-08", "2026-03-08", "America/Los_Angeles"),
    ).toMatchObject({
      fromTimestamp: "2026-03-08T08:00:00.000Z",
      toExclusiveTimestamp: "2026-03-09T07:00:00.000Z",
      days: [
        {
          day: "2026-03-08",
          fromTimestamp: "2026-03-08T08:00:00.000Z",
          toExclusiveTimestamp: "2026-03-09T07:00:00.000Z",
        },
      ],
    });
  });
});
