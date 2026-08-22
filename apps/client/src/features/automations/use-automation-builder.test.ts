// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import type { AutomationOptions } from "./automation-types";
import { useAutomationBuilder } from "./use-automation-builder";

const definition: AutomationDefinition = {
  name: "Welcome",
  description: "",
  timezone: "Asia/Tokyo",
  nodes: [
    {
      id: "source",
      type: "source",
      position: { x: 0, y: 0 },
      config: { source: "contact_created", reentry: "once" },
    },
  ],
  edges: [],
};

const options: AutomationOptions = { templates: [], forms: [], segments: [] };

function useControlledBuilder(initial: AutomationDefinition) {
  const [current, setCurrent] = useState(initial);
  return {
    builder: useAutomationBuilder(current, setCurrent),
    definition: current,
    replace: setCurrent,
  };
}

describe("useAutomationBuilder", () => {
  it("adds a node, connects it from the selected node, and selects it", () => {
    const { result } = renderHook(() => useControlledBuilder(definition));
    let status: ReturnType<typeof result.current.builder.addNode> | undefined;

    act(() => {
      status = result.current.builder.addNode("delay", options);
    });

    const added = result.current.definition.nodes[1];
    expect(status).toBe("connected");
    expect(added?.type).toBe("delay");
    expect(result.current.definition.edges).toEqual([
      expect.objectContaining({ source: "source", target: added?.id, branch: "next" }),
    ]);
    expect(result.current.builder.selectedNodeId).toBe(added?.id);
  });

  it("connects two controlled graph nodes", () => {
    const unconnected: AutomationDefinition = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: "delay",
          type: "delay",
          position: { x: 200, y: 0 },
          config: { mode: "relative", minutes: 60 },
        },
      ],
    };
    const { result } = renderHook(() => useControlledBuilder(unconnected));
    let connected = false;

    act(() => {
      connected = result.current.builder.connect({
        source: "source",
        target: "delay",
        sourceHandle: null,
        targetHandle: null,
      });
    });

    expect(connected).toBe(true);
    expect(result.current.definition.edges).toEqual([
      expect.objectContaining({ source: "source", target: "delay", branch: "next" }),
    ]);
  });

  it("updates selection and deletes the selected node with its edges", () => {
    const connected: AutomationDefinition = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: "delay",
          type: "delay",
          position: { x: 200, y: 0 },
          config: { mode: "relative", minutes: 60 },
        },
      ],
      edges: [{ id: "edge", source: "source", target: "delay", branch: "next" }],
    };
    const { result } = renderHook(() => useControlledBuilder(connected));

    act(() => result.current.builder.selectNode("delay"));
    expect(result.current.builder.selectedNode?.id).toBe("delay");

    act(() => result.current.builder.deleteSelectedNode());
    expect(result.current.definition.nodes.map((node) => node.id)).toEqual(["source"]);
    expect(result.current.definition.edges).toEqual([]);
    expect(result.current.builder.selectedNodeId).toBeNull();
  });

  it("selects the first node when a controlled definition replaces the selected entity", () => {
    const { result } = renderHook(() => useControlledBuilder(definition));
    const replacement: AutomationDefinition = {
      ...definition,
      name: "Replacement",
      nodes: [{ ...definition.nodes[0]!, id: "replacement-source" }],
    };

    act(() => result.current.replace(replacement));

    expect(result.current.builder.selectedNode?.id).toBe("replacement-source");
    expect(result.current.builder.selectedNodeId).toBe("replacement-source");
  });
});
