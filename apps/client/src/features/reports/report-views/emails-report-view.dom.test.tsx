// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { EmailsReport } from "../report-api";
import { EmailsReportView } from "./emails-report-view";

vi.mock("../report-widgets", () => ({
  TrendCard: () => null,
  ReportTableCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sourceTypeLabel: () => "配信元",
}));
afterEach(cleanup);
function report(sends: number): EmailsReport {
  return {
    category: "emails",
    range: { from: "2026-09-01", to: "2026-09-12" },
    summary: {
      sends,
      delivered: 0,
      opens: 0,
      clicks: 0,
      bounces: 0,
      unsubscribes: 0,
      complaints: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      clickToOpenRate: 0,
      bounceRate: 0,
      unsubscribeRate: 0,
    },
    trend: [],
    sources: [],
  };
}
it("shows unavailable rates when no emails were sent", () => {
  render(<EmailsReportView report={report(0)} />);
  expect(screen.getAllByText("—")).toHaveLength(5);
  expect(screen.queryByText("0%")).toBeNull();
});
it("keeps delivery measurable but open and click rates unavailable when nothing was delivered", () => {
  render(<EmailsReportView report={report(10)} />);
  expect(screen.getAllByText("0%")).toHaveLength(2);
  expect(screen.getAllByText("—")).toHaveLength(3);
});
