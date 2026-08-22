import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ getCurrentSession: vi.fn() }));

vi.mock("@/lib/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-session")>()),
  getCurrentSession: authState.getCurrentSession,
}));

import { Route as ProtectedRoute } from "./_app";
import { Route as LoginRoute } from "./login";
import { Route as OnboardingRoute } from "./onboarding";

type BeforeLoad = (input: unknown) => Promise<unknown>;

describe("SSR auth redirects", () => {
  beforeEach(() => authState.getCurrentSession.mockReset());

  it.each([
    ["protected", ProtectedRoute],
    ["onboarding", OnboardingRoute],
  ])("redirects an anonymous %s request to login", async (_name, route) => {
    authState.getCurrentSession.mockResolvedValue(null);
    const beforeLoad = route.options.beforeLoad as BeforeLoad;

    await expect(
      beforeLoad({
        context: {},
        location: { href: "/dashboard" },
      }),
    ).rejects.toMatchObject({
      options: {
        to: "/login",
        replace: true,
      },
    });
  });

  it("redirects an authenticated login request to the dashboard", async () => {
    authState.getCurrentSession.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1", email: "person@example.test", name: "Person" },
    });
    const beforeLoad = LoginRoute.options.beforeLoad as BeforeLoad;

    await expect(beforeLoad({})).rejects.toMatchObject({
      options: { to: "/dashboard", replace: true },
    });
  });
});
