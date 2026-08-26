import { describe, expect, it, vi } from "vitest";

import { Route as AppRoute } from "./_app";
import { Route as OnboardingRoute } from "./onboarding";

const viewer = { id: "user-1", name: "Person", email: "person@example.test" };

describe("bootstrap route boundaries", () => {
  it("warms the protected app bootstrap cache without returning loader context", async () => {
    const workspace = {
      id: "workspace-1",
      name: "Acme",
      slug: "acme",
      logo: null,
      timezone: "UTC",
      created_at: 0,
      role: "owner",
      capabilities: {
        viewReports: true,
        manageMarketing: true,
        manageWorkspace: true,
        manageApiKeys: true,
      },
    };
    const ensureQueryData = vi.fn<() => Promise<unknown>>(async () => ({
      viewer,
      workspace,
      workspaces: [],
    }));
    const beforeLoad = AppRoute.options.beforeLoad as (input: unknown) => Promise<unknown>;

    await expect(
      beforeLoad({
        context: { queryClient: { ensureQueryData } },
        location: { href: "/dashboard" },
      }),
    ).resolves.toBeUndefined();
    expect(ensureQueryData).toHaveBeenCalledOnce();
  });

  it("keeps a signed-in viewer with no workspace on onboarding without route context", async () => {
    const ensureQueryData = vi.fn<() => Promise<unknown>>(async () => ({
      viewer,
      workspace: null,
      workspaces: [],
    }));
    const beforeLoad = OnboardingRoute.options.beforeLoad as (input: unknown) => Promise<unknown>;

    await expect(
      beforeLoad({
        context: { queryClient: { ensureQueryData } },
        location: { href: "/onboarding" },
      }),
    ).resolves.toBeUndefined();
    expect(ensureQueryData).toHaveBeenCalledOnce();
  });
});
