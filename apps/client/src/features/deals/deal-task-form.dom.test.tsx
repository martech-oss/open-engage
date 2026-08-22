// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceTimeProvider } from "@/lib/workspace-time";

import { DealTaskForm } from "./deal-forms";

describe("DealTaskForm workspace time", () => {
  it("submits datetime-local input as the workspace instant", async () => {
    const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    render(
      <WorkspaceTimeProvider
        value={{
          timeZone: "America/Los_Angeles",
          renderedAt: "2026-08-23T00:00:00.000Z",
        }}
      >
        <DealTaskForm members={[]} submitLabel="保存" onSubmit={onSubmit} />
      </WorkspaceTimeProvider>,
    );

    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: "Follow up" } });
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "2026-08-22T17:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ dueAt: "2026-08-23T00:15:00.000Z" }),
      ),
    );
  });
});
