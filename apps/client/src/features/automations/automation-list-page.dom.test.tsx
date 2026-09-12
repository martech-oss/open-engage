// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AutomationRow } from "@openengage/core/automations";

import { AutomationsPage } from "./automation-list-page";
import { filterAutomations, validateAutomationListSearch } from "./automation-list-search";

const doubles = vi.hoisted(() => ({
  search: {} as { q?: string; status?: "paused" | "active" },
  navigate: vi.fn<(input: unknown) => void>(),
  create: vi.fn<(input: unknown) => Promise<unknown>>(),
  setStatus: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
}));
const rows: AutomationRow[] = [
  {
    id: "a",
    name: "Welcome",
    description: "New customers",
    status: "active",
    triggerSource: "contact_created",
    enrollmentCount: 120,
    activeCount: 12,
    completedCount: 108,
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "b",
    name: "Follow up",
    description: "Welcome sequence",
    status: "paused",
    triggerSource: "batch",
    enrollmentCount: 20,
    activeCount: 5,
    completedCount: 15,
    updatedAt: "2026-09-02T00:00:00Z",
  },
];
vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => doubles.search }),
  useNavigate: () => doubles.navigate,
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { id: string };
    search: object;
  }) => (
    <a href={`/automations/${params.id}?${new URLSearchParams(search as Record<string, string>)}`}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: (options: { kind: string }) => ({
    data: options.kind === "automations" ? rows : [],
  }),
}));
vi.mock("./automation-api", () => ({
  automationsQueryOptions: () => ({ kind: "automations" }),
  useCreateAutomation: () => ({ mutateAsync: doubles.create }),
  useSetAutomationStatus: () => ({ mutateAsync: doubles.setStatus, isPending: false }),
}));
vi.mock("@/features/emails/email-api", () => ({
  emailTemplateOptionsQueryOptions: () => ({ kind: "templates" }),
}));
vi.mock("@/lib/workspace-time", () => ({
  useWorkspaceTime: () => ({ timeZone: "Asia/Tokyo" }),
  useWorkspaceFormatters: () => ({ formatDateTime: (value: string) => value }),
}));
vi.mock("@/components/app-ui", async (original) => ({
  ...(await original<object>()),
  PageLayout: ({
    title,
    action,
    children,
  }: {
    title: string;
    action: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {action}
      {children}
    </main>
  ),
}));
beforeEach(() => {
  doubles.search = {};
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("automation monitoring list", () => {
  it("restores combined search and status, and carries them into the editor link", () => {
    doubles.search = { q: "welcome", status: "paused" };
    render(<AutomationsPage />);
    expect(screen.queryByRole("link", { name: "Welcome" })).toBeNull();
    expect(screen.getByRole("link", { name: "Follow up" }).getAttribute("href")).toContain(
      "q=welcome&status=paused",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "フローを検索" }), {
      target: { value: "next" },
    });
    expect(doubles.navigate).toHaveBeenCalledWith({
      to: "/automations",
      search: { q: "next", status: "paused" },
      replace: true,
    });
    expect(doubles.create).not.toHaveBeenCalled();
  });
  it("pauses and resumes the selected flow without navigating", async () => {
    render(<AutomationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Welcomeを一時停止" }));
    await waitFor(() =>
      expect(doubles.setStatus).toHaveBeenCalledWith({ id: "a", status: "paused" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Follow upを再開" }));
    await waitFor(() =>
      expect(doubles.setStatus).toHaveBeenCalledWith({ id: "b", status: "active" }),
    );
    expect(doubles.navigate).not.toHaveBeenCalled();
  });
  it("offers all four creation paths from one keyboard accessible entry", async () => {
    const user = userEvent.setup();
    render(<AutomationsPage />);
    const create = screen.getByRole("button", { name: "フローを作成" });
    create.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "空のフローから作成" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "プリセットから作成" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AIで作成" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AIメールシーケンス" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "空のフローから作成" }));
    expect(await screen.findByRole("dialog", { name: "オートメーションを作成" })).toBeTruthy();
    expect(doubles.create).not.toHaveBeenCalled();
  });
  it("ignores invalid URL filters and handles whitespace and descriptions", () => {
    expect(validateAutomationListSearch({ q: 12, status: "unknown" })).toEqual({
      q: undefined,
      status: undefined,
    });
    expect(
      filterAutomations(rows, { q: "  WELCOME  ", status: "paused" }).map((row) => row.id),
    ).toEqual(["b"]);
    expect(filterAutomations(rows, { q: "missing" })).toEqual([]);
  });
});
