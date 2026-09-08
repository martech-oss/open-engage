import { expect, it } from "vitest";

import * as automation from "./index";
import type { AutomationDefinition } from "./schema";
const callable = (name: string, child?: string): AutomationDefinition =>
  automation.automationDefinitionSchema.parse({
    name,
    nodes: [
      { id: "source", type: "source", position: { x: 0, y: 0 }, config: { source: "callable" } },
      ...(child
        ? [
            {
              id: "call",
              type: "action",
              position: { x: 1, y: 0 },
              config: { action: "call_automation", automationId: child, mode: "await" },
            },
          ]
        : []),
    ],
    edges: child ? [{ id: "edge", source: "source", target: "call", branch: "next" }] : [],
  });
it("pins callable versions recursively and rejects cycles or missing workspace dependencies", async () => {
  const pin = automation.pinAutomationDependencies;
  const child = callable("Child");
  let current = "v1";
  const load = async (id: string) =>
    id === "child"
      ? {
          automationId: id,
          versionId: current,
          graph: child,
          dependencies: {},
          variableSnapshot: null,
        }
      : null;
  const result = await pin(
    "parent",
    callable("Parent", "child"),
    { schemaVersion: 1, projectId: "project", values: [] },
    load,
  );
  current = "v2";
  expect(result.dependencies.call?.versionId).toBe("v1");
  expect(result.dependencies.call?.graph.variableProjectId).toBe("project");
  await expect(
    pin(
      "parent",
      callable("Parent", "missing"),
      { schemaVersion: 1, projectId: null, values: [] },
      load,
    ),
  ).rejects.toThrow();
  await expect(
    pin(
      "parent",
      callable("Parent", "parent"),
      { schemaVersion: 1, projectId: null, values: [] },
      load,
    ),
  ).rejects.toThrow(/cycle/i);
});
