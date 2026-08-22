import { describe, expect, it } from "vitest";

import { siteMessageScheduleSchema } from "./schema";

describe("siteMessageScheduleSchema", () => {
  it("accepts an ordered schedule", () => {
    expect(
      siteMessageScheduleSchema.safeParse({
        startsAt: "2026-08-23T00:15:00.000Z",
        endsAt: "2026-08-23T01:45:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an end that is not after the start", () => {
    const result = siteMessageScheduleSchema.safeParse({
      startsAt: "2026-08-23T01:45:00.000Z",
      endsAt: "2026-08-23T00:15:00.000Z",
    });
    if (result.success) throw new Error("Expected an invalid schedule");
    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ["endsAt"], message: "endsAt must be after startsAt" }),
    ]);
  });
});
