import { expect, it } from "vitest";

import type { VariableSnapshot } from "../projects/variables";
import * as automation from "./index";
const snapshot: VariableSnapshot = {
  schemaVersion: 1,
  projectId: "project",
  values: [
    {
      id: "delay",
      workspaceId: "ws",
      projectId: null,
      key: "wait",
      type: "number",
      value: 30,
      revision: 1,
      updatedAt: "now",
    },
  ],
};
it("resolves only supported scalar fields and retains explicit project context", () => {
  const input = {
    name: "Variables",
    variableProjectId: "project",
    nodes: [
      { id: "start", type: "source", position: { x: 0, y: 0 }, config: { source: "callable" } },
      {
        id: "delay",
        type: "delay",
        position: { x: 1, y: 0 },
        config: { mode: "relative", minutes: { kind: "variable", key: "wait", type: "number" } },
      },
    ],
    edges: [],
  };
  const parsed = automation.automationDefinitionSchema.safeParse(input);
  expect(parsed.success).toBe(true);
  const resolved = automation.resolveAutomationVariables(
    automation.automationDefinitionSchema.parse(input),
    snapshot,
  );
  expect(resolved.nodes[1]?.config).toHaveProperty("minutes", 30); // resolved snapshot stays immutable
  expect(resolved.nodes[1]?.type).toBe("delay");
  expect(
    automation.automationVariableReferences(automation.automationDefinitionSchema.parse(input)),
  ).toEqual([{ kind: "variable", key: "wait", type: "number" }]);
  snapshot.values[0]!.value = 60;
  expect(resolved.nodes[1]?.config).toHaveProperty("minutes", 30); // resolved snapshot stays immutable
  expect(resolved.nodes[1]?.type).toBe("delay");
});
