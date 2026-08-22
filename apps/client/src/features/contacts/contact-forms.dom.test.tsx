// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mutateAsync, assignInitialContactRelations } = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<{ id: string }>>(),
  assignInitialContactRelations: vi.fn<(input: unknown) => Promise<void>>(),
}));

vi.mock("@/features/contacts/contact-api", () => ({
  useCreateContact: () => ({ mutateAsync }),
  assignInitialContactRelations,
}));

vi.mock("@/features/companies/company-api", () => ({
  invalidateCompanyQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/features/segments/segment-api", () => ({
  createDynamicSegment: vi.fn<() => Promise<void>>(),
  invalidateSegmentsList: vi.fn<() => Promise<void>>(),
}));

import { ContactCreateForm } from "./contact-forms";

describe("ContactCreateForm", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: "contact-1" });
    assignInitialContactRelations.mockReset().mockResolvedValue(undefined);
  });

  it("submits one create command containing every selected initial relation", async () => {
    const onSaved = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithQueryClient(
      <ContactCreateForm
        open
        onOpenChange={() => undefined}
        options={{
          tags: [{ id: "tag-1", name: "VIP", slug: "vip", color: "#000000", contactCount: 0 }],
          segments: [
            {
              id: "segment-1",
              name: "Customers",
              slug: "customers",
              kind: "static",
              description: "",
              filterAst: null,
              membershipSource: "Manual selection",
              filterVersion: 1,
              memberCount: 0,
              evaluatedAt: null,
              evaluationStatus: "ready",
              evaluationError: null,
            },
          ],
          companies: [{ id: "company-1", name: "Acme", domain: null, contactCount: 0 }],
          stages: [],
        }}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText("メールアドレス"), "atomic@example.com");
    await user.selectOptions(screen.getByLabelText("会社"), "company-1");
    await user.selectOptions(screen.getByLabelText("タグ"), "tag-1");
    await user.selectOptions(screen.getByLabelText("リスト"), "segment-1");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        email: "atomic@example.com",
        firstName: undefined,
        lastName: undefined,
        phone: undefined,
        externalId: undefined,
        stage: "lead",
        customFields: {},
        tagId: "tag-1",
        segmentId: "segment-1",
        companyId: "company-1",
      }),
    );
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(assignInitialContactRelations).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}
