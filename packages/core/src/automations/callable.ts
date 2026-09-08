import type { VariableSnapshot } from "../projects/variables";
import { validateAutomation } from "./automation";
import type { AutomationDependency, AutomationExecutionSnapshot } from "./execution";
import type { AutomationDefinition } from "./schema";
import { resolveAutomationVariables } from "./variables";

/** Publication captures every call site. Children reuse their published dependency versions. */
export async function pinAutomationDependencies(
  automationId: string,
  definition: AutomationDefinition,
  snapshot: VariableSnapshot,
  loadPublished: (id: string) => Promise<AutomationDependency | null>,
  validateResources?: (graph: AutomationDefinition) => Promise<void>,
): Promise<AutomationExecutionSnapshot> {
  let count = 0;
  async function visit(
    id: string,
    source: AutomationDefinition,
    path: string[],
    pinned?: Record<string, AutomationDependency>,
  ): Promise<AutomationExecutionSnapshot> {
    if (path.includes(id))
      throw new Error(`Callable automation cycle: ${[...path, id].join(" → ")}`);
    if (++count > 100 || path.length >= 20) throw new Error("Callable dependency limit exceeded");
    const graph = resolveAutomationVariables(
      { ...source, variableProjectId: snapshot.projectId },
      snapshot,
    );
    const issues = validateAutomation(graph);
    if (issues.length) throw new Error(issues.map((issue) => issue.message).join("; "));
    await validateResources?.(graph);
    const dependencies: Record<string, AutomationDependency> = {};
    for (const node of graph.nodes) {
      if (node.type !== "action" || node.config.action !== "call_automation") continue;
      if ([...path, id].includes(node.config.automationId))
        throw new Error("Callable automation cycle");
      const child =
        pinned?.[node.id] ?? (pinned ? null : await loadPublished(node.config.automationId));
      if (!child || child.automationId !== node.config.automationId)
        throw new Error(`Published callable automation unavailable: ${node.config.automationId}`);
      const sourceGraph = child.sourceGraph ?? child.graph;
      if (
        !sourceGraph.nodes.some(
          (node) => node.type === "source" && node.config.source === "callable",
        )
      )
        throw new Error("Child must use callable start");
      dependencies[node.id] = {
        automationId: child.automationId,
        versionId: child.versionId,
        sourceGraph: structuredClone(sourceGraph),
        ...(await visit(child.automationId, sourceGraph, [...path, id], child.dependencies)),
      };
    }
    return { graph, variableSnapshot: structuredClone(snapshot), dependencies };
  }
  return visit(automationId, definition, []);
}
