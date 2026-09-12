// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dashboard } from "@openengage/core/reports";

const fetchDashboard = vi.hoisted(() => vi.fn<() => Promise<Dashboard>>());
vi.mock("./dashboard-api", () => ({
  dashboardQueryOptions: () => ({ queryKey: ["monitor-test"], queryFn: fetchDashboard }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/lib/workspace-time", () => ({
  useWorkspaceFormatters: () => ({
    formatDateTime: (value: string) => value,
    formatRelativeTime: (value: string) => value,
  }),
}));
vi.mock("@/components/app-ui/bar-chart", () => ({
  SimpleBarChart: ({ series }: { series: { label: string }[] }) => (
    <div>
      {series.map((s) => (
        <span key={s.label}>{s.label}</span>
      ))}
    </div>
  ),
}));
import { DashboardPage } from "./dashboard-page";
const range = { from: "2026-08-14", to: "2026-09-12" };
function fixture(): Dashboard {
  return {
    asOf: "2026-09-12T06:00:00Z",
    timezone: "Asia/Tokyo",
    contacts: { count: 12, trend: { ...range, points: [] }, changePercent: null },
    automations: {
      count: 1,
      draftCount: 0,
      enrolledCount: 2,
      top: [
        {
          id: "flow-1",
          name: "資料請求フォロー",
          active: 2,
          completed: 8,
          updatedAt: "2026-09-12T05:00:00Z",
        },
      ],
    },
    briefs: { overdueReviews: 0 },
    deliveries: {
      sent: 0,
      delivered: 0,
      failed: 0,
      deliveryRate: 0,
      totalsRange: range,
      health: { ...range, points: [] },
      sendChangePercent: null,
      deliveryRateChangePoints: null,
    },
    deals: {
      range,
      currency: "JPY",
      created: 0,
      openCount: 0,
      openValue: 0,
      averageOpenValue: 0,
      openTasks: 0,
      overdueTasks: 0,
      completedTasks: 0,
    },
    recentEvents: [],
    recentActivity: [],
  };
}
let client: QueryClient;
beforeEach(() => {
  fetchDashboard.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function renderMonitor() {
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>読み込み中</p>}>
        <DashboardPage />
      </Suspense>
    </QueryClientProvider>,
  );
}
describe("monitor", () => {
  it("collapses a clear attention area and labels unavailable rates and timestamps", async () => {
    fetchDashboard.mockResolvedValue(fixture());
    renderMonitor();
    await screen.findByText("現在、要確認項目はありません");
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getAllByText("比較データなし")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "更新日時" })).toBeTruthy();
    expect(screen.queryByText("最終実行")).toBeNull();
  });
  it("shows actionable failures separately from unconfirmed delivery", async () => {
    const data = fixture();
    data.deliveries = {
      ...data.deliveries,
      sent: 10,
      delivered: 8,
      failed: 1,
      deliveryRate: 80,
      health: {
        ...range,
        points: [{ day: "2026-09-12", sends: 10, delivered: 8, undelivered: 2 }],
      },
    };
    data.briefs.overdueReviews = 2;
    data.deals.overdueTasks = 3;
    fetchDashboard.mockResolvedValue(data);
    renderMonitor();
    await screen.findByRole("region", { name: "要確認" });
    expect(screen.getByText("配信失敗")).toBeTruthy();
    expect(screen.getByText("施策レビュー期限超過")).toBeTruthy();
    expect(screen.getByText("営業タスク期限超過")).toBeTruthy();
    expect(screen.getAllByText("到達未確認").length).toBeGreaterThan(0);
  });
  it("retains the previous dataset after a failed manual refresh and can retry", async () => {
    fetchDashboard
      .mockResolvedValueOnce(fixture())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...fixture(), contacts: { ...fixture().contacts, count: 99 } });
    renderMonitor();
    await screen.findByText("資料請求フォロー");
    await userEvent.click(screen.getByRole("button", { name: /^更新$/ }));
    await screen.findByText(/更新できませんでした。直前/);
    expect(screen.getByText("資料請求フォロー")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^更新$/ }));
    await waitFor(() => expect(screen.queryByText(/更新できませんでした。直前/)).toBeNull());
    expect(screen.getByText("99")).toBeTruthy();
  });
});
