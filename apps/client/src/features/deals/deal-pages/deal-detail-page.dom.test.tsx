// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DealDetailData, DealOptions } from "../deal-api";
import type * as DealApiModule from "../deal-api";
import { DealDetailPage } from "./deal-detail-page";

const mutations = vi.hoisted(() => ({
  updateDeal: { mutateAsync: vi.fn<(input: unknown) => Promise<void>>() },
  archiveDeal: { mutateAsync: vi.fn<(input: unknown) => Promise<void>>() },
  createTask: { mutateAsync: vi.fn<(input: unknown) => Promise<void>>() },
  updateTask: { mutateAsync: vi.fn<(input: unknown) => Promise<void>>() },
  deleteTask: { mutateAsync: vi.fn<(input: unknown) => Promise<void>>() },
}));

const detail: DealDetailData = {
  deal: {
    id: "deal-a",
    workspaceId: "workspace-a",
    pipelineId: "pipeline-a",
    pipelineName: "Sales",
    stageId: "stage-a",
    stageName: "Qualified",
    stageColor: "#00ff00",
    stagePosition: 1,
    stageProbability: 50,
    name: "Enterprise renewal",
    value: 100000,
    currency: "JPY",
    status: "open",
    ownerUserId: null,
    ownerName: null,
    ownerEmail: null,
    contactId: null,
    contactEmail: null,
    contactFirstName: null,
    contactLastName: null,
    companyId: null,
    companyName: null,
    expectedCloseDate: null,
    description: "",
    wonAt: null,
    lostAt: null,
    archivedAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    openTaskCount: 1,
    nextTaskAt: null,
  },
  tasks: [
    {
      id: "task-a",
      dealId: "deal-a",
      contactId: null,
      type: "call",
      title: "Call buyer",
      notes: "",
      dueAt: null,
      status: "open",
      assignedUserId: null,
      assigneeName: null,
      assigneeEmail: null,
      completedAt: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
  ],
};

const options: DealOptions = { pipelines: [], contacts: [], companies: [], members: [] };

vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: (query: { kind: string }) => ({
    data: query.kind === "detail" ? detail : options,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/deals">{children}</a>,
  useNavigate: () => vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock("@/components/app-ui", () => ({
  AppDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ArchiveConfirm: () => null,
  EmptyState: () => null,
  LoadingButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  MetricCard: ({ label, value }: { label: string; value: ReactNode }) => (
    <div>
      {label}: {value}
    </div>
  ),
  PageLayout: ({ action, children }: { action: ReactNode; children: ReactNode }) => (
    <main>
      {action}
      {children}
    </main>
  ),
}));

vi.mock("../deal-forms", () => ({
  DealForm: () => null,
  DealTaskForm: () => null,
  TaskRow: ({ onToggle }: { onToggle: () => Promise<void> }) => (
    <button onClick={() => void onToggle()}>タスクを切り替え</button>
  ),
}));

vi.mock("../deal-widgets", () => ({
  DealStatusBadge: () => null,
  DetailItem: () => null,
}));

vi.mock("../deal-api", async (importOriginal) => {
  const original = await importOriginal<typeof DealApiModule>();
  return {
    ...original,
    dealDetailQueryOptions: () => ({ kind: "detail" }),
    dealOptionsQueryOptions: () => ({ kind: "options" }),
    useUpdateDeal: () => mutations.updateDeal,
    useArchiveDeal: () => mutations.archiveDeal,
    useCreateDealTask: () => mutations.createTask,
    useUpdateDealTask: () => mutations.updateTask,
    useDeleteDealTask: () => mutations.deleteTask,
  };
});

beforeEach(() => {
  for (const mutation of Object.values(mutations))
    mutation.mutateAsync.mockReset().mockResolvedValue();
});

afterEach(cleanup);

describe("DealDetailPage actions", () => {
  it("keeps stage context and submits status and task transitions", async () => {
    render(<DealDetailPage dealId="deal-a" />);

    expect(screen.getByText(/Sales \/ Qualified/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "獲得" }));
    fireEvent.click(screen.getByRole("button", { name: "タスクを切り替え" }));

    await waitFor(() =>
      expect(mutations.updateDeal.mutateAsync).toHaveBeenCalledWith({
        id: "deal-a",
        status: "won",
      }),
    );
    expect(mutations.updateTask.mutateAsync).toHaveBeenCalledWith({
      dealId: "deal-a",
      taskId: "task-a",
      status: "completed",
    });
  });
});
