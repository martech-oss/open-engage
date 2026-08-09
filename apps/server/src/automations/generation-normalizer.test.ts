import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import { normalizeGeneratedAutomation } from "./generation-normalizer";

function generatedDefinition(): AutomationDefinition {
  return {
    name: "Generated",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 999, y: 999 },
        config: { source: "contact_created", reentry: "once" },
      },
      {
        id: "delay",
        type: "delay",
        position: { x: 999, y: 999 },
        config: { mode: "relative", minutes: 60 },
      },
    ],
    edges: [{ id: "edge", source: "source", target: "delay", branch: "next" }],
  };
}

describe("normalizeGeneratedAutomation", () => {
  it("replaces generated ids and lays out a new graph", () => {
    const ids = ["node-1", "node-2", "edge-1"];
    const result = normalizeGeneratedAutomation(generatedDefinition(), undefined, () =>
      ids.shift()!,
    );

    expect(result.nodes.map((node) => node.id)).toEqual(["node-1", "node-2"]);
    expect(result.edges).toEqual([
      { id: "edge-1", source: "node-1", target: "node-2", branch: "next" },
    ]);
    expect(result.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 80 },
      { x: 360, y: 80 },
    ]);
  });

  it("preserves existing ids and positions while assigning ids to new nodes", () => {
    const current = generatedDefinition();
    current.nodes = [current.nodes[0]!];
    current.nodes[0]!.position = { x: 42, y: 84 };
    current.edges = [];
    const ids = ["new-delay", "new-edge"];
    const result = normalizeGeneratedAutomation(generatedDefinition(), current, () => ids.shift()!);

    expect(result.nodes[0]).toMatchObject({ id: "source", position: { x: 42, y: 84 } });
    expect(result.nodes[1]?.id).toBe("new-delay");
    expect(result.edges[0]?.id).toBe("new-edge");
  });
});
