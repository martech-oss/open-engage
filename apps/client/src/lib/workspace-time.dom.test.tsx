// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceTimeProvider, useWorkspaceFormatters } from "./workspace-time";

afterEach(cleanup);

function TimestampProbe() {
  const { formatDateTime, formatRelativeTime } = useWorkspaceFormatters();
  return (
    <div>
      <span>{formatDateTime("2026-01-02T01:30:00.000Z")}</span>
      <span>{formatRelativeTime("2026-01-02T01:27:00.000Z")}</span>
    </div>
  );
}

describe("workspace time delivery", () => {
  it("renders timestamps and relative labels with one non-UTC workspace clock", () => {
    render(
      <WorkspaceTimeProvider
        value={{
          timeZone: "America/Los_Angeles",
          renderedAt: "2026-01-02T01:30:00.000Z",
        }}
      >
        <TimestampProbe />
      </WorkspaceTimeProvider>,
    );

    expect(screen.getByText("2026/01/01 17:30")).toBeTruthy();
    expect(screen.getByText("3分前")).toBeTruthy();
  });
});
