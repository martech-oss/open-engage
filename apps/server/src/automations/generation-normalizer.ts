import type { AutomationDefinition, AutomationNode } from "@openengage/core/automations";

const LAYOUT_ORIGIN = { x: 80, y: 80 } as const;
const LAYOUT_COLUMN_GAP = 280;
const LAYOUT_ROW_GAP = 140;

export function normalizeGeneratedAutomation(
  definition: AutomationDefinition,
  currentDefinition: AutomationDefinition | undefined,
  createId: () => string,
): AutomationDefinition {
  const currentNodeIds = new Set(currentDefinition?.nodes.map((node) => node.id) ?? []);
  const currentEdgeIds = new Set(currentDefinition?.edges.map((edge) => edge.id) ?? []);
  const currentPositions = new Map(
    currentDefinition?.nodes.map((node) => [node.id, node.position] as const) ?? [],
  );
  const generatedPositions = layoutPositions(definition);
  const nodeIds = new Map<string, string>();

  for (const node of definition.nodes) {
    nodeIds.set(node.id, currentNodeIds.has(node.id) ? node.id : createId());
  }

  const nodes = definition.nodes.map((node) => {
    const id = nodeIds.get(node.id) ?? createId();
    const position =
      currentPositions.get(node.id) ?? generatedPositions.get(node.id) ?? node.position;
    return { ...node, id, position } as AutomationNode;
  });
  const edges = definition.edges.map((edge) => ({
    ...edge,
    id: currentEdgeIds.has(edge.id) ? edge.id : createId(),
    source: nodeIds.get(edge.source) ?? edge.source,
    target: nodeIds.get(edge.target) ?? edge.target,
  }));

  return { ...definition, nodes, edges };
}

function layoutPositions(definition: AutomationDefinition): Map<string, { x: number; y: number }> {
  const source = definition.nodes.find((node) => node.type === "source");
  if (!source) return new Map();

  const depth = new Map<string, number>([[source.id, 0]]);
  const queue = [source.id];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    const nextDepth = (depth.get(nodeId) ?? 0) + 1;
    for (const edge of definition.edges.filter((item) => item.source === nodeId)) {
      const existingDepth = depth.get(edge.target);
      if (existingDepth === undefined || nextDepth > existingDepth) {
        depth.set(edge.target, nextDepth);
        queue.push(edge.target);
      }
    }
  }

  const rows = new Map<number, number>();
  return new Map(
    definition.nodes.map((node) => {
      const column = depth.get(node.id) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return [
        node.id,
        {
          x: LAYOUT_ORIGIN.x + column * LAYOUT_COLUMN_GAP,
          y: LAYOUT_ORIGIN.y + row * LAYOUT_ROW_GAP,
        },
      ];
    }),
  );
}
