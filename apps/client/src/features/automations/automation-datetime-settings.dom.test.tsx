// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkspaceTimeProvider } from "@/lib/workspace-time";
import type { VariableRef } from "@openengage/core/projects";

import { VariableSetting } from "./automation-node-settings/variable-setting";
afterEach(cleanup);
it("edits absolute dates in Workspace time and stores an unambiguous UTC instant", () => {
  const change = vi.fn<(value: string | VariableRef) => void>();
  render(
    <WorkspaceTimeProvider
      value={{ timeZone: "Asia/Tokyo", renderedAt: "2026-09-08T00:00:00.000Z" }}
    >
      <VariableSetting
        label="待機終了日時"
        type="datetime"
        value="2026-09-08T00:00:00.000Z"
        onChange={change}
      />
    </WorkspaceTimeProvider>,
  );
  const input = screen.getByLabelText("待機終了日時");
  expect(input.getAttribute("type")).toBe("datetime-local");
  expect((input as HTMLInputElement).value).toBe("2026-09-08T09:00");
  fireEvent.change(input, { target: { value: "2026-09-09T10:30" } });
  expect(change).toHaveBeenLastCalledWith("2026-09-09T01:30:00.000Z");
});
