// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApiKeyController } from "./api-key-controller";

describe("useApiKeyController", () => {
  it("exposes the one-time token after creation succeeds", async () => {
    const create = vi.fn<() => Promise<{ token: string }>>(async () => ({
      token: "secret-token",
    }));
    const { result } = renderHook(() => useApiKeyController(create));

    await act(() => result.current.create());

    expect(result.current.token).toBe("secret-token");
    expect(result.current.error).toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("retains a useful failure without exposing a stale token", async () => {
    const create = vi
      .fn<() => Promise<{ token: string }>>()
      .mockResolvedValueOnce({ token: "old-token" })
      .mockRejectedValueOnce(new Error("service unavailable"));
    const { result } = renderHook(() => useApiKeyController(create));
    await act(() => result.current.create());

    await act(() => result.current.create());

    expect(result.current.token).toBe("");
    expect(result.current.error).toBe("service unavailable");
    expect(result.current.busy).toBe(false);
  });
});
