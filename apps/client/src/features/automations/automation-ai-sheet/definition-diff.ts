import type { AutomationDefinition } from "@openengage/core/automations";

export function definitionDiff(
  before: AutomationDefinition,
  after: AutomationDefinition,
): { added: number; changed: number; removed: number } {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterIds = new Set(after.nodes.map((node) => node.id));
  let added = 0;
  let changed = 0;
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous) added += 1;
    else if (
      JSON.stringify(previous) !== JSON.stringify(node) ||
      outgoingSignature(before, node.id) !== outgoingSignature(after, node.id)
    ) {
      changed += 1;
    }
  }
  return {
    added,
    changed,
    removed: before.nodes.filter((node) => !afterIds.has(node.id)).length,
  };
}

function outgoingSignature(definition: AutomationDefinition, nodeId: string): string {
  return definition.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => `${edge.branch}:${edge.target}`)
    .sort()
    .join("|");
}
