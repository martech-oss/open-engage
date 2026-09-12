// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useContactDrawerController } from "./contact-drawer-controller";

const doubles = vi.hoisted(() => ({
  archive: vi.fn<(contactId: string) => Promise<unknown>>(),
  restore: vi.fn<(contactId: string) => Promise<unknown>>(),
  update: vi.fn<(contactId: string, input: unknown) => Promise<unknown>>(),
  adjustScore: vi.fn<(contactId: string, input: unknown) => Promise<unknown>>(),
  assignTag: vi.fn<(contactId: string, resourceId: string) => Promise<unknown>>(),
  removeTag: vi.fn<(contactId: string, resourceId: string) => Promise<unknown>>(),
  addSegment: vi.fn<(contactId: string, resourceId: string) => Promise<unknown>>(),
  removeSegment: vi.fn<(contactId: string, resourceId: string) => Promise<unknown>>(),
  invalidateOptions: vi.fn<(queryClient: QueryClient) => Promise<void>>(),
}));

vi.mock("./contact-api", () => ({
  contactProfileQueryOptions: (contactId: string) => ({
    queryKey: ["contacts", "profile", contactId],
    queryFn: () => null,
  }),
  archiveContact: doubles.archive,
  restoreContact: doubles.restore,
  updateContact: doubles.update,
  adjustContactScore: doubles.adjustScore,
  assignContactTag: doubles.assignTag,
  removeContactTag: doubles.removeTag,
  addContactToSegment: doubles.addSegment,
  removeContactFromSegment: doubles.removeSegment,
  invalidateContactOptions: doubles.invalidateOptions,
}));

beforeEach(() => {
  vi.clearAllMocks();
  doubles.invalidateOptions.mockResolvedValue();
});

describe("useContactDrawerController", () => {
  it("refreshes the profile, options, and list after a successful mutation", async () => {
    doubles.archive.mockResolvedValue({});
    const onChanged = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { result, queryClient } = renderController("contact-1", onChanged);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(() => result.current.archive());

    expect(doubles.archive).toHaveBeenCalledWith("contact-1");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["contacts", "profile", "contact-1"],
    });
    expect(doubles.invalidateOptions).toHaveBeenCalledWith(queryClient);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("");
    expect(result.current.activeTab).toBe("activity");
  });

  it("exposes a mutation failure without refreshing cached reads", async () => {
    doubles.archive.mockRejectedValue(new Error("archive denied"));
    const onChanged = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { result, queryClient } = renderController("contact-1", onChanged);

    await act(() => result.current.archive());

    expect(result.current.error).toBe("archive denied");
    expect(queryClient.getQueryState(["contacts", "profile", "contact-1"])?.isInvalidated).toBe(
      false,
    );
    expect(doubles.invalidateOptions).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("derives a fresh tab and error state when the selected contact changes", async () => {
    doubles.archive.mockRejectedValue(new Error("first contact failed"));
    const onChanged = vi.fn<() => Promise<void>>().mockResolvedValue();
    const queryClient = queryClientWithProfiles();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ contactId }) => useContactDrawerController(contactId, onChanged),
      { initialProps: { contactId: "contact-1" }, wrapper },
    );
    act(() => result.current.setActiveTab("details"));
    await act(() => result.current.archive());

    rerender({ contactId: "contact-2" });

    expect(result.current.activeTab).toBe("activity");
    expect(result.current.error).toBe("");
    expect(result.current.profile?.contact.id).toBe("contact-2");
  });
});

function renderController(contactId: string, onChanged: () => Promise<void>) {
  const queryClient = queryClientWithProfiles();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useContactDrawerController(contactId, onChanged), { wrapper });
  return { ...rendered, queryClient };
}

function queryClientWithProfiles() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["contacts", "profile", "contact-1"], profile("contact-1"));
  queryClient.setQueryData(["contacts", "profile", "contact-2"], profile("contact-2"));
  return queryClient;
}

function profile(id: string) {
  return {
    contact: {
      id,
      workspaceId: "workspace-1",
      visitorId: null,
      email: `${id}@example.com`,
      firstName: "Contact",
      lastName: id,
      phone: null,
      externalId: null,
      stage: "lead",
      score: 0,
      gradePoints: 0,
      status: "active",
      archivedAt: null,
      customFields: {},
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    },
    tags: [],
    segments: [],
    companies: [],
    scoreEvents: [],
    timeline: [],
  };
}
