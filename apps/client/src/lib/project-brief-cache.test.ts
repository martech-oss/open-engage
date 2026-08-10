import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateProjectBriefQueries } from "./project-brief-cache";

describe("invalidateProjectBriefQueries", () => {
  it("invalidates list, detail, and dashboard prefixes exactly once", async () => {
    const invalidateQueries = vi
      .fn<QueryClient["invalidateQueries"]>()
      .mockResolvedValue(undefined);
    await invalidateProjectBriefQueries({ invalidateQueries } as unknown as QueryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries.mock.calls.every(([input]) => Array.isArray(input?.queryKey))).toBe(
      true,
    );
    expect(
      new Set(invalidateQueries.mock.calls.map(([input]) => JSON.stringify(input?.queryKey))).size,
    ).toBe(3);
  });
});
