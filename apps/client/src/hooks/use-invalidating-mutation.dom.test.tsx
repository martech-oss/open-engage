// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useInvalidatingMutation } from "./use-invalidating-mutation";

describe("useInvalidatingMutation", () => {
  it("resolves mutateAsync only after the listed roots refetched", async () => {
    const queryClient = new QueryClient();
    const order: string[] = [];
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async ({ queryKey } = {}) => {
      await Promise.resolve();
      order.push(`invalidate:${JSON.stringify(queryKey)}`);
    });
    const { result } = renderHook(
      () =>
        useInvalidatingMutation(
          {
            mutationFn: async (name: string) => name,
            onSuccess: () => {
              order.push("caller onSuccess");
            },
          },
          [["items"], ["items"], ["counts"]],
        ),
      { wrapper: withClient(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync("created");
      order.push("resolved");
    });

    expect(order).toEqual([
      'invalidate:["items"]',
      'invalidate:["counts"]',
      "caller onSuccess",
      "resolved",
    ]);
  });

  it("passes variables and data to a custom invalidation", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.fn<(client: QueryClient, id: string, data: number) => Promise<void>>(
      async () => undefined,
    );
    const { result } = renderHook(
      () => useInvalidatingMutation({ mutationFn: async (id: string) => id.length }, invalidate),
      { wrapper: withClient(queryClient) },
    );

    await act(() => result.current.mutateAsync("deal-1"));

    expect(invalidate).toHaveBeenCalledWith(queryClient, "deal-1", 6);
  });
});

function withClient(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
