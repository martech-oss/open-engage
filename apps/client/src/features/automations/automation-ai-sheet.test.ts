import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import { definitionDiff } from "./automation-ai-sheet";

function definition(): AutomationDefinition {
  return {
    name: "Flow",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "contact_created", reentry: "once" },
      },
      {
        id: "delay",
        type: "delay",
        position: { x: 1, y: 1 },
        config: { mode: "relative", minutes: 60 },
      },
    ],
    edges: [{ id: "edge", source: "source", target: "delay", branch: "next" }],
  };
}

describe("definitionDiff", () => {
  it("counts added, removed and changed nodes", () => {
    const before = definition();
    const after = definition();
    after.nodes[1] = {
      id: "email",
      type: "action",
      position: { x: 1, y: 1 },
      config: { action: "send_email", templateId: "template" },
    };
    after.edges[0] = { id: "edge", source: "source", target: "email", branch: "next" };

    expect(definitionDiff(before, after)).toEqual({ added: 1, changed: 1, removed: 1 });
  });

  it("counts connection changes against the source node", () => {
    const before = definition();
    const after = definition();
    after.edges = [];

    expect(definitionDiff(before, after)).toEqual({ added: 0, changed: 1, removed: 0 });
  });
});
