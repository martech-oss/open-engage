// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkspaceTimeProvider } from "@/lib/workspace-time";
import type { SegmentFilter } from "@openengage/core/segments";

import { AutomationFilterEditor } from "./automation-filter-editor";

vi.mock("./automation-api", () => ({
  automationFilterCatalogQueryOptions: () => ({
    queryKey: ["filter-options"],
    queryFn: async () => ({
      tags: [],
      staticSegments: [],
      companies: [],
      subscriptionTopics: [],
      events: [],
      customFields: [],
      stages: [],
    }),
  }),
}));
afterEach(cleanup);
it("keeps an incomplete date editable and converts the corrected value from Workspace time", async () => {
  const changes = vi.fn<(value: SegmentFilter) => void>();
  function Editor() {
    const [value, setValue] = useState<SegmentFilter>({
      kind: "condition",
      field: "created_at",
      operator: "gte",
      value: "2026-09-08T00:00:00.000Z",
    });
    return (
      <AutomationFilterEditor
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceTimeProvider
        value={{ timeZone: "Asia/Tokyo", renderedAt: "2026-09-08T00:00:00.000Z" }}
      >
        <Editor />
      </WorkspaceTimeProvider>
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("条件値");
  fireEvent.change(input, { target: { value: "" } });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(changes).toHaveBeenLastCalledWith({
    kind: "condition",
    field: "created_at",
    operator: "gte",
    value: "",
  });
  fireEvent.change(input, { target: { value: "2026-09-09T10:30" } });
  expect(changes).toHaveBeenLastCalledWith({
    kind: "condition",
    field: "created_at",
    operator: "gte",
    value: "2026-09-09T01:30:00.000Z",
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
