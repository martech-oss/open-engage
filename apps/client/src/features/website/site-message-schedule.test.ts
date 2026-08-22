import { describe, expect, it } from "vitest";

import { normalizeSiteMessageSchedule } from "./site-message-schedule";

describe("normalizeSiteMessageSchedule", () => {
  it("converts Tokyo wall time to UTC before persistence", () => {
    expect(
      normalizeSiteMessageSchedule(
        { startsAt: "2026-08-23T09:15", endsAt: "2026-08-23T10:45" },
        "Asia/Tokyo",
      ),
    ).toEqual({
      startsAt: "2026-08-23T00:15:00.000Z",
      endsAt: "2026-08-23T01:45:00.000Z",
    });
  });

  it("rejects an end that is not after the start", () => {
    expect(() =>
      normalizeSiteMessageSchedule(
        { startsAt: "2026-08-23T10:45", endsAt: "2026-08-23T09:15" },
        "Asia/Tokyo",
      ),
    ).toThrow("終了日時は開始日時より後にしてください");
  });
});
