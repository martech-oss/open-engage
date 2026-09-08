// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ContactSales } from "./contact-sales";

const { create, handoff } = vi.hoisted(() => ({
  create: vi.fn<(...args: unknown[]) => void>(),
  handoff: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock("@/lib/app-bootstrap", () => ({
  appBootstrapQueryOptions: () => ({
    queryKey: ["bootstrap"],
    queryFn: async () => ({ workspace: { capabilities: { manageMarketing: true } } }),
  }),
}));
vi.mock("@/lib/workspace-time", () => ({
  useWorkspaceFormatters: () => ({
    toDateTimeLocal: (v: string) => v,
    fromDateTimeLocal: (v: string) => v,
    formatDateTime: (v: string) => v,
  }),
}));
vi.mock("./sales-api", () => ({
  salesMembersQueryOptions: () => ({
    queryKey: ["members"],
    queryFn: async () => [{ id: "user", name: "Owner" }],
  }),
  assignmentGroupsQueryOptions: () => ({
    queryKey: ["groups"],
    queryFn: async () => [{ id: "group", name: "Sales group", mode: "round_robin" }],
  }),
  contactTasksQueryOptions: () => ({
    queryKey: ["tasks"],
    queryFn: async () => [
      {
        id: "task",
        title: "Existing",
        type: "task",
        notes: "",
        assignedUserId: "user",
        assigneeName: "Owner",
        dueAt: null,
        status: "open",
      },
    ],
  }),
  useCreateContactTask: () => ({ mutate: create }),
  useSalesHandoff: () => ({ mutate: handoff }),
  useUpdateTaskResource: () => ({ mutate: () => undefined }),
  useDeleteTaskResource: () => ({ mutate: () => undefined }),
  useSetTaskStatus: () => ({ mutate: () => undefined }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("reserves group assignment for handoff and requires a personal task assignee selection", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContactSales contactId="contact" />
    </QueryClientProvider>,
  );
  const select = await screen.findByLabelText("営業担当の割り当て");
  await screen.findByRole("option", { name: "Sales group (round_robin)" });
  fireEvent.change(select, { target: { value: "group:group" } });
  const add = screen.getByRole<HTMLButtonElement>("button", { name: "タスク追加" });
  expect(add.disabled).toBe(true);
  fireEvent.click(add);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "営業へ引き継ぐ" }));
  expect(handoff).toHaveBeenCalledWith(
    expect.objectContaining({ contactId: "contact", groupId: "group" }),
    expect.any(Object),
  );
  fireEvent.change(select, { target: { value: "user:user" } });
  fireEvent.click(add);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ assignedUserId: "user" }));
  fireEvent.click(screen.getByRole("button", { name: "編集" }));
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: "Sales group (round_robin)" })).toBeNull(),
  );
});
