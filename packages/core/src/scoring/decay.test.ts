import { describe, expect, it } from "vitest";

import { remainingContribution } from "./decay";
describe("whole-day linear score decay", () => {
  it("rounds remaining points down, ignores partial days and reaches zero", () => {
    const start = "2026-09-01T12:00:00.000Z";
    expect(remainingContribution(25, 10, start, new Date("2026-09-02T11:59:59.999Z"))).toBe(25);
    expect(remainingContribution(25, 10, start, new Date("2026-09-06T12:00:00.000Z"))).toBe(12);
    expect(remainingContribution(25, 10, start, new Date("2026-09-11T12:00:00.000Z"))).toBe(0);
    expect(remainingContribution(25, null, start, new Date("2028-01-01"))).toBe(25);
  });
});
