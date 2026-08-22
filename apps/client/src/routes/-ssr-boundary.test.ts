import { describe, expect, it, vi } from "vitest";

import { Route as RootRoute } from "./__root";
import { Route as ProtectedRoute } from "./_app";
import { Route as LoginRoute } from "./login";
import { Route as OnboardingRoute } from "./onboarding";

describe("SSR route boundary", () => {
  it.each([
    ["protected", ProtectedRoute],
    ["login", LoginRoute],
    ["onboarding", OnboardingRoute],
  ])("runs the %s route on the server", (_name, route) => {
    expect(route.options.ssr).not.toBe(false);
  });

  it("provides one render timestamp to every child route", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T01:30:00.000Z"));
    try {
      expect(RootRoute.options.beforeLoad?.({} as never)).toEqual({
        renderedAt: "2026-01-02T01:30:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
