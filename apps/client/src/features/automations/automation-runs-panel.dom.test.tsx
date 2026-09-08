// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AutomationRunProgress } from "./automation-runs-panel";
afterEach(cleanup);
it("distinguishes enrollment completion from flow completion and exposes failure detail", () => {
  render(
    <AutomationRunProgress
      run={{
        id: "run",
        workspaceId: "ws",
        automationId: "auto",
        automationVersionId: "version",
        slot: "manual:key",
        status: "running",
        createdAt: "now",
        updatedAt: "now",
        enrollmentCompletedAt: "now",
        completedAt: null,
        lastError: "登録が中断されました",
        targetCount: 5,
        enrolledCount: 3,
        skippedCount: 1,
        failedCount: 1,
        pendingCount: 0,
        flowCompletedCount: 1,
        flowActiveCount: 2,
        flowFailedCount: 0,
      }}
    />,
  );
  expect(screen.getByText(/登録作業: 完了/).textContent).toContain("フロー完了 1人 / 実行中 2人");
  expect(screen.getByRole("alert").textContent).toBe("登録が中断されました");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("5");
});
