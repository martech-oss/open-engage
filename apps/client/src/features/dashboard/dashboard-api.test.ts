import { describe, expect, it } from "vitest";

import { orpcQuery } from "@/lib/orpc";

import { dashboardQueryOptions } from "./dashboard-api";

describe("dashboard query", () => {
  it("uses the generated page-ready dashboard query", () => {
    expect(dashboardQueryOptions().queryKey).toEqual(
      orpcQuery.dashboard.get.queryOptions().queryKey,
    );
  });
});
