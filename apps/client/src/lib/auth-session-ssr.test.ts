import { dehydrate } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { appBootstrapSchema } from "@openengage/orpc";

import { createQueryClient } from "./query-client";

describe("SSR app bootstrap dehydration", () => {
  it("never serializes Better Auth token, IP address, or user-agent sentinels", () => {
    const bootstrap = appBootstrapSchema.parse({
      viewer: {
        id: "user-1",
        name: "Person",
        email: "person@example.test",
        emailVerified: true,
      },
      workspace: null,
      workspaces: [],
      session: {
        id: "session-1",
        token: "ssr-sentinel-token",
        ipAddress: "ssr-sentinel-ipAddress",
        userAgent: "ssr-sentinel-userAgent",
      },
    });
    const queryClient = createQueryClient();
    queryClient.setQueryData(["app", "bootstrap"], bootstrap);

    const serialized = JSON.stringify(dehydrate(queryClient));
    expect(serialized).toContain("person@example.test");
    expect(serialized).not.toMatch(/ssr-sentinel|token|ipAddress|userAgent/);
  });
});
