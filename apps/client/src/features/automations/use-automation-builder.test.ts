import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import { automationBuilderReducer } from "./use-automation-builder";

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

describe("automationBuilderReducer", () => {
  it("replaces the graph without losing node selection", () => {
    const state = automationBuilderReducer(
      { definition, selectedNodeId: "source" },
      { type: "replace_definition", definition: { ...definition, name: "Updated" } },
    );

    expect(state.definition.name).toBe("Updated");
    expect(state.selectedNodeId).toBe("source");
  });

  it("updates graph and selection atomically when adding or deleting a node", () => {
    const state = automationBuilderReducer(
      { definition, selectedNodeId: "source" },
      {
        type: "replace_and_select",
        definition: { ...definition, nodes: [] },
        nodeId: null,
      },
    );

    expect(state.definition.nodes).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });

  it("resets the graph and selection when the route entity changes", () => {
    const next = {
      ...definition,
      name: "Another automation",
      nodes: [{ ...definition.nodes[0]!, id: "another-source" }],
    };
    const state = automationBuilderReducer(
      { definition, selectedNodeId: "source" },
      { type: "reset_for_entity", definition: next },
    );

    expect(state.definition.name).toBe("Another automation");
    expect(state.selectedNodeId).toBe("another-source");
  });
});
