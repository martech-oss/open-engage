// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { usePreviewProjectClone, useRetryProjectClone, useStartProjectClone } from "./clone-api";

// Replace only the RPC boundary; the feature mutations and query cache remain real.
const rpc = vi.hoisted(() => ({
  preview: vi.fn<(input: unknown) => Promise<{ id: string }>>(async (_input) => ({
    id: "preview",
  })),
  start: vi.fn<(input: unknown) => Promise<{ id: string }>>(async (_input) => ({ id: "started" })),
  retry: vi.fn<(input: unknown) => Promise<{ id: string }>>(async (_input) => ({ id: "retried" })),
}));
vi.mock("@/lib/orpc", () => ({
  orpcQuery: {
    projects: {
      key: () => ["projects"],
      clonePreview: { mutationOptions: () => ({ mutationFn: rpc.preview }) },
      cloneStart: { mutationOptions: () => ({ mutationFn: rpc.start }) },
      cloneRetry: { mutationOptions: () => ({ mutationFn: rpc.retry }) },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  {
    name: "preview",
    input: { id: "source", options: { name: "Copy", variables: {} } },
    result: { id: "preview" },
  },
  {
    name: "start",
    input: { id: "source", jobId: "job", requestKey: "job" },
    result: { id: "started" },
  },
  {
    name: "retry",
    input: { id: "source", jobId: "job" },
    result: { id: "retried" },
  },
] as const)(
  "invalidates project queries after clone $name without invalidating unrelated data",
  async (test) => {
    const client = new QueryClient();
    const keys = [
      ["projects", "list"],
      ["projects", "cloneList", "source"],
      ["projects", "cloneProgress", "source", "job"],
      ["contacts", "list"],
    ];
    for (const key of keys) client.setQueryData(key, { value: "cached" });
    const { result } = renderHook(
      () => ({
        preview: usePreviewProjectClone(),
        start: useStartProjectClone(),
        retry: useRetryProjectClone(),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await act(async () => {
      const output =
        test.name === "preview"
          ? await result.current.preview.mutateAsync(test.input)
          : test.name === "start"
            ? await result.current.start.mutateAsync(test.input)
            : await result.current.retry.mutateAsync(test.input);
      expect(output).toEqual(test.result);
    });
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(rpc[test.name]).toHaveBeenCalledWith(test.input, expect.anything());
    client.clear();
  },
);
