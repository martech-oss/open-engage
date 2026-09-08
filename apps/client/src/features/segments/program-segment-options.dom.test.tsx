// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  segmentConditionSchema,
  type SegmentCondition,
  type SegmentGenerationCatalog,
} from "@openengage/core/segments";

import { SegmentConditionEditor } from "./segment-condition-editor";

afterEach(cleanup);
it("saves and reloads the chosen program status version without replacing it with another meaning", () => {
  const catalog: SegmentGenerationCatalog = {
    tags: [],
    staticSegments: [],
    companies: [],
    subscriptionTopics: [],
    customFields: [],
    events: [],
    stages: [],
    projectStatuses: [
      {
        id: "project:1:attended",
        name: "Event / v1 / Attended",
        value: '["project",1,"attended"]',
        programStatus: { projectId: "project", definitionVersion: 1, statusId: "attended" },
      },
      {
        id: "project:2:attended",
        name: "Event / v2 / Not attended",
        value: '["project",2,"attended"]',
        programStatus: { projectId: "project", definitionVersion: 2, statusId: "attended" },
      },
    ],
  };
  const change = vi.fn<(condition: SegmentCondition) => void>();
  const props = { catalog, defaults: { dateTimeLocal: "2026-09-08T09:00" }, onChange: change };
  const view = render(
    <SegmentConditionEditor
      {...props}
      condition={{ kind: "condition", field: "project_status", operator: "eq", value: "attended" }}
    />,
  );
  fireEvent.change(screen.getByLabelText("条件値"), {
    target: { value: '["project",1,"attended"]' },
  });
  const saved = segmentConditionSchema.parse(JSON.parse(JSON.stringify(change.mock.calls[0]![0])));
  expect(saved).toMatchObject({
    value: "attended",
    program: { projectId: "project", definitionVersion: 1 },
  });
  view.rerender(<SegmentConditionEditor {...props} condition={saved} />);
  expect(screen.getByLabelText("条件値")).toHaveProperty("value", '["project",1,"attended"]');
  expect(screen.getByRole("option", { name: "Event / v1 / Attended" })).toHaveProperty(
    "selected",
    true,
  );
  expect(screen.getByRole("option", { name: "Event / v2 / Not attended" })).toHaveProperty(
    "selected",
    false,
  );
  fireEvent.change(screen.getByLabelText("演算子"), { target: { value: "neq" } });
  expect(change.mock.calls[1]![0]).toMatchObject({ operator: "neq", program: saved.program });
  expect(screen.getByRole("option", { name: "全施策・全定義版 / attended" })).toBeTruthy();
});
