import { describe, expect, it } from "vitest";

import { availableSlug } from "./slug-service";

describe("availableSlug", () => {
  it("uses -2, then -3, then a bounded safe random suffix", async () => {
    const unavailable = new Set(["campaign", "campaign-2", "campaign-3"]);
    const checked: string[] = [];
    const slug = await availableSlug("Campaign", "resource", async (candidate) => {
      checked.push(candidate);
      return !unavailable.has(candidate);
    });

    expect(checked.slice(0, 3)).toEqual(["campaign", "campaign-2", "campaign-3"]);
    expect(slug).toMatch(/^campaign-[a-z0-9]{8}$/);
    expect(slug.length).toBeLessThanOrEqual(80);
  });
});
