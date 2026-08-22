// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { emailBrandProfileQueryOptions, type EmailBrandProfile } from "@/features/emails/email-api";
import type { Workspace } from "@/lib/workspace";

import { useSettingsController } from "./settings-controller";

const profile: EmailBrandProfile = {
  brandName: "OpenEngage",
  companyDescription: "Description",
  tone: "Clear",
  logoAssetId: null,
  websiteUrl: "https://example.com",
  primaryColor: "#112233",
  backgroundColor: "#ffffff",
  textColor: "#000000",
  postalAddress: "Tokyo",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const workspace: Workspace = {
  id: "workspace-1",
  name: "Workspace",
  slug: "workspace",
  logo: null,
  timezone: "Asia/Tokyo",
  created_at: 0,
  role: "marketer",
  capabilities: {
    viewReports: true,
    manageMarketing: true,
    manageWorkspace: false,
    manageApiKeys: false,
  },
};

describe("useSettingsController", () => {
  it("owns the loader-prefetched brand read and capability projection", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(emailBrandProfileQueryOptions().queryKey, profile);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSettingsController(workspace), { wrapper });

    expect(result.current.brandProfile).toEqual(profile);
    expect(result.current.permissions).toEqual({
      canEditWorkspace: false,
      canManageApiKeys: false,
    });
  });
});
