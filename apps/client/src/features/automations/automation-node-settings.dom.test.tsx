// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationEdge, AutomationNode } from "@openengage/core/automations";

import { NodeSettings } from "./automation-node-settings";
import type { AutomationOptions } from "./automation-types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/emails/templates">{children}</a>,
}));

const options: AutomationOptions = {
  templates: [
    {
      id: "template-a",
      name: "Welcome",
      purpose: "transactional",
      subject: "Welcome",
      sendable: true,
    },
  ],
  forms: [
    { id: "form-a", name: "Form A" },
    { id: "form-b", name: "Form B" },
  ],
  segments: [
    { id: "segment-a", name: "Segment A" },
    { id: "segment-b", name: "Segment B" },
  ],
};

afterEach(cleanup);

describe("NodeSettings patches", () => {
  it.each<{
    name: string;
    node: AutomationNode;
    label: string;
    value: string;
    expectedConfig: AutomationNode["config"];
  }>([
    {
      name: "source",
      node: {
        id: "source",
        type: "source",
        position: { x: 1, y: 2 },
        config: { source: "form_submitted", formId: "form-a", reentry: "every_time" },
      },
      label: "フォーム",
      value: "form-b",
      expectedConfig: { source: "form_submitted", formId: "form-b", reentry: "every_time" },
    },
    {
      name: "action",
      node: {
        id: "action",
        type: "action",
        position: { x: 3, y: 4 },
        config: { action: "change_score", amount: 5 },
      },
      label: "スコア変更量",
      value: "12",
      expectedConfig: { action: "change_score", amount: 12 },
    },
    {
      name: "delay",
      node: {
        id: "delay",
        type: "delay",
        position: { x: 5, y: 6 },
        config: { mode: "relative", minutes: 10 },
      },
      label: "待機時間（分）",
      value: "42",
      expectedConfig: { mode: "relative", minutes: 42 },
    },
    {
      name: "decision",
      node: {
        id: "decision",
        type: "decision",
        position: { x: 7, y: 8 },
        config: { event: "opened", resourceId: "old", withinMinutes: 60 },
      },
      label: "対象ID（任意）",
      value: "new-resource",
      expectedConfig: { event: "opened", resourceId: "new-resource", withinMinutes: 60 },
    },
    {
      name: "condition",
      node: {
        id: "condition",
        type: "condition",
        position: { x: 9, y: 10 },
        config: { field: "stage", operator: "eq", value: "lead" },
      },
      label: "連絡先フィールド",
      value: "status",
      expectedConfig: { field: "status", operator: "eq", value: "lead" },
    },
  ])("updates only the $name config field", ({ node, label, value, expectedConfig }) => {
    let updated: AutomationNode | null = null;
    renderSettings(node, (update) => {
      updated = update(node);
    });

    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    expect(updated).toEqual({ ...node, config: expectedConfig });
  });

  it("keeps branch-specific connection pickers and reports the selected target", () => {
    const node: AutomationNode = {
      id: "condition",
      type: "condition",
      position: { x: 0, y: 0 },
      config: { field: "stage", operator: "eq", value: "lead" },
    };
    const target: AutomationNode = {
      id: "action",
      type: "action",
      position: { x: 1, y: 1 },
      config: { action: "change_score", amount: 1 },
    };
    const onConnectionChange =
      vi.fn<(sourceId: string, branch: AutomationEdge["branch"], targetId: string) => void>();

    renderSettings(node, () => undefined, [node, target], onConnectionChange);
    fireEvent.change(screen.getByLabelText("はいの接続先"), {
      target: { value: target.id },
    });

    expect(onConnectionChange).toHaveBeenCalledWith("condition", "yes", "action");
    expect(screen.getByLabelText("いいえの接続先")).toBeTruthy();
  });
});

function renderSettings(
  node: AutomationNode,
  onUpdate: (update: (node: AutomationNode) => AutomationNode) => void,
  nodes: AutomationNode[] = [node],
  onConnectionChange: (
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ) => void = () => undefined,
): void {
  render(
    <NodeSettings
      node={node}
      nodes={nodes}
      edges={[]}
      options={options}
      onUpdate={onUpdate}
      onConnectionChange={onConnectionChange}
      onDelete={() => undefined}
    />,
  );
}
