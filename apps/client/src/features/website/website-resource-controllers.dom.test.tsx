// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCustomRedirectsController } from "./custom-redirects-controller";
import { useLandingPagesController } from "./landing-pages-controller";
import { useSignupFormsController } from "./signup-forms-controller";
import { useSiteMessagesController } from "./site-messages-controller";

const doubles = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() });
  return {
    formArchive: mutation(),
    pageArchive: mutation(),
    messageArchive: mutation(),
    redirectArchive: mutation(),
    passiveMutation: mutation(),
  };
});

type Archive = (item: { id: string }) => Promise<void>;

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}));
vi.mock("./website-api", () => ({
  signupFormsQueryOptions: () => ({ queryKey: ["website", "forms"], queryFn: () => [] }),
  landingPagesQueryOptions: () => ({ queryKey: ["website", "pages"], queryFn: () => [] }),
  siteMessagesQueryOptions: () => ({ queryKey: ["website", "messages"], queryFn: () => [] }),
  customRedirectsQueryOptions: () => ({ queryKey: ["website", "redirects"], queryFn: () => [] }),
  siteTrackingQueryOptions: () => ({
    queryKey: ["website", "tracking"],
    queryFn: () => ({ workspaceSlug: "workspace" }),
  }),
  useArchiveSignupForm: () => doubles.formArchive,
  useArchiveLandingPage: () => doubles.pageArchive,
  useArchiveSiteMessage: () => doubles.messageArchive,
  useArchiveCustomRedirect: () => doubles.redirectArchive,
  useCreateSignupForm: () => doubles.passiveMutation,
  useUpdateSignupForm: () => doubles.passiveMutation,
  useCreateLandingPage: () => doubles.passiveMutation,
  useUpdateLandingPage: () => doubles.passiveMutation,
  useCreateSiteMessage: () => doubles.passiveMutation,
  useUpdateSiteMessage: () => doubles.passiveMutation,
  useCreateCustomRedirect: () => doubles.passiveMutation,
  useUpdateCustomRedirect: () => doubles.passiveMutation,
}));

const cases = [
  {
    name: "signup forms",
    useController: () => ({
      archive: useSignupFormsController("workspace", "https://public.example").archive as Archive,
    }),
    mutation: doubles.formArchive,
    success: "サインアップフォームをアーカイブしました",
  },
  {
    name: "landing pages",
    useController: () => ({
      archive: useLandingPagesController("workspace", "https://public.example").archive as Archive,
    }),
    mutation: doubles.pageArchive,
    success: "ランディングページをアーカイブしました",
  },
  {
    name: "site messages",
    useController: () => ({ archive: useSiteMessagesController().archive as Archive }),
    mutation: doubles.messageArchive,
    success: "サイトメッセージをアーカイブしました",
  },
  {
    name: "custom redirects",
    useController: () => ({
      archive: useCustomRedirectsController("https://public.example").archive as Archive,
    }),
    mutation: doubles.redirectArchive,
    success: "リンクをアーカイブしました",
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("website resource controllers", () => {
  it.each(cases)("reports $name archive success", async ({ useController, mutation, success }) => {
    mutation.mutateAsync.mockResolvedValue({});
    const { result } = renderHook(useController, { wrapper: queryWrapper() });

    await act(() => result.current.archive({ id: "resource-1" }));

    expect(mutation.mutateAsync).toHaveBeenCalledWith({ id: "resource-1" });
    expect(toast.success).toHaveBeenCalledWith(success);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "reports $name archive failure without success",
    async ({ useController, mutation }) => {
      mutation.mutateAsync.mockRejectedValue(new Error("archive unavailable"));
      const { result } = renderHook(useController, { wrapper: queryWrapper() });

      await act(() => result.current.archive({ id: "resource-1" }));

      expect(mutation.mutateAsync).toHaveBeenCalledWith({ id: "resource-1" });
      expect(toast.error).toHaveBeenCalledWith("archive unavailable");
      expect(toast.success).not.toHaveBeenCalled();
    },
  );
});

function queryWrapper() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["website", "forms"], []);
  queryClient.setQueryData(["website", "pages"], []);
  queryClient.setQueryData(["website", "messages"], []);
  queryClient.setQueryData(["website", "redirects"], []);
  queryClient.setQueryData(["website", "tracking"], {
    enabled: true,
    allowedDomains: [],
    consentMode: "required",
    workspaceSlug: "workspace",
    summary: { pageViews: 0, uniqueVisitors: 0, identifiedContacts: 0 },
    topPages: [],
    recentEvents: [],
    updatedAt: null,
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
