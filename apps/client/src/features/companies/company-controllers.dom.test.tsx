// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCompaniesListController } from "./companies-list-controller";
import { useCompanyDetailController } from "./company-detail-controller";

const doubles = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => Promise<void>>(),
  create: { mutateAsync: vi.fn<(input: unknown) => Promise<{ id: string }>>() },
  update: { mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() },
  assign: { mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() },
  remove: { mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() },
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => doubles.navigate }));
vi.mock("@/hooks/use-debounced-search", () => ({ useDebouncedSearch: () => undefined }));
vi.mock("@/lib/workspace-time", () => ({
  useWorkspaceFormatters: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}));
vi.mock("./company-api", () => ({
  companiesQueryOptions: () => ({ queryKey: ["companies", "list"], queryFn: () => [] }),
  companyQueryOptions: (id: string) => ({
    queryKey: ["companies", "detail", id],
    queryFn: () => null,
  }),
  companyEnrichmentCapabilityQueryOptions: () => ({
    queryKey: ["companies", "capability"],
    queryFn: () => ({ enabled: true }),
  }),
  companyContactOptionsQueryOptions: () => ({
    queryKey: ["companies", "contacts"],
    queryFn: () => ({ items: [] }),
  }),
  useCreateCompany: () => doubles.create,
  useUpdateCompany: () => doubles.update,
  useAssignCompanyContact: () => doubles.assign,
  useRemoveCompanyContact: () => doubles.remove,
}));

beforeEach(() => {
  vi.clearAllMocks();
  doubles.navigate.mockResolvedValue();
});

describe("useCompaniesListController", () => {
  it("closes creation and navigates only after a successful create", async () => {
    doubles.create.mutateAsync.mockResolvedValue({ id: "company-2" });
    const { result } = renderHook(() => useCompaniesListController(""), {
      wrapper: queryWrapper(),
    });
    act(() => result.current.setCreateOpen(true));

    await act(() => result.current.create({ name: "Created" }));

    expect(doubles.create.mutateAsync).toHaveBeenCalledWith({ name: "Created" });
    expect(result.current.createOpen).toBe(false);
    expect(doubles.navigate.mock.calls.map(([options]) => options)).toContainEqual({
      to: "/companies/$id",
      params: { id: "company-2" },
    });
  });

  it("keeps creation open and does not navigate when create fails", async () => {
    doubles.create.mutateAsync.mockRejectedValue(new Error("create failed"));
    const { result } = renderHook(() => useCompaniesListController(""), {
      wrapper: queryWrapper(),
    });
    act(() => result.current.setCreateOpen(true));

    await act(() => result.current.create({ name: "Created" }).catch(() => undefined));

    expect(result.current.createOpen).toBe(true);
    expect(doubles.navigate.mock.calls).toEqual([]);
  });
});

describe("useCompanyDetailController", () => {
  it("closes editing only after a successful update", async () => {
    doubles.update.mutateAsync.mockResolvedValue({});
    const { result } = renderHook(() => useCompanyDetailController("company-1"), {
      wrapper: queryWrapper(),
    });
    act(() => result.current.setEditOpen(true));

    await act(() => result.current.update({ name: "Updated" }));

    expect(doubles.update.mutateAsync).toHaveBeenCalledWith({
      id: "company-1",
      name: "Updated",
      domain: null,
    });
    expect(result.current.editOpen).toBe(false);
  });

  it("keeps editing open when update fails", async () => {
    doubles.update.mutateAsync.mockRejectedValue(new Error("update failed"));
    const { result } = renderHook(() => useCompanyDetailController("company-1"), {
      wrapper: queryWrapper(),
    });
    act(() => result.current.setEditOpen(true));

    await act(() => result.current.update({ name: "Updated" }).catch(() => undefined));

    expect(result.current.editOpen).toBe(true);
  });
});

function queryWrapper() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["companies", "list"], []);
  queryClient.setQueryData(["companies", "capability"], { enabled: true });
  queryClient.setQueryData(["companies", "contacts"], { items: [] });
  queryClient.setQueryData(["companies", "detail", "company-1"], {
    id: "company-1",
    name: "Company",
    domain: "example.com",
    contacts: [],
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
