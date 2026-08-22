// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { keys } = vi.hoisted(() => ({
  keys: {
    contacts: ["contacts", "list"],
    options: ["contacts", "options"],
    companies: ["companies", "list"],
    company: ["companies", "get", "company-1"],
    segments: ["segments", "list"],
    segment: ["segments", "get", "segment-1"],
    unrelated: ["assets", "list"],
  },
}));

vi.mock("@/lib/orpc", () => ({
  orpc: { contacts: {} },
  orpcQuery: {
    contacts: {
      create: {
        mutationOptions: () => ({
          mutationFn: async () => ({ id: "contact-1" }),
        }),
      },
      list: {
        key: () => keys.contacts,
        queryOptions: vi.fn<() => unknown>(),
      },
      options: { key: () => keys.options },
    },
    companies: {
      list: { key: () => keys.companies },
      get: { key: () => keys.company },
    },
    segments: {
      list: { key: () => keys.segments },
      get: { key: () => keys.segment },
    },
  },
}));

import { useCreateContact } from "./contact-api";

describe("useCreateContact", () => {
  it("invalidates the contact and selected relation read models as one mutation outcome", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of Object.values(keys)) queryClient.setQueryData(key, { cached: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateContact(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        email: "cache@example.com",
        customFields: {},
        tagId: "tag-1",
        segmentId: "segment-1",
        companyId: "company-1",
      }),
    );

    for (const key of [
      keys.contacts,
      keys.options,
      keys.companies,
      keys.company,
      keys.segments,
      keys.segment,
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(keys.unrelated)?.isInvalidated).toBe(false);
  });
});
