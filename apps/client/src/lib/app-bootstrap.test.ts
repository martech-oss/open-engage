import { describe, expect, it, vi } from "vitest";

import { ensureAppBootstrap } from "./app-bootstrap";

describe("ensureAppBootstrap", () => {
  it("uses the shared bootstrap query and returns its cached DTO", async () => {
    const bootstrap = {
      viewer: { id: "user-1", name: "Owner", email: "owner@example.test" },
      workspace: null,
      workspaces: [],
    };
    const ensureQueryData = vi.fn<
      (options: { queryKey: readonly unknown[] }) => Promise<typeof bootstrap>
    >(async (options) => {
      expect(options.queryKey).toBeDefined();
      return bootstrap;
    });

    await expect(ensureAppBootstrap({ ensureQueryData } as never)).resolves.toBe(bootstrap);
    expect(ensureQueryData).toHaveBeenCalledOnce();
  });
});
