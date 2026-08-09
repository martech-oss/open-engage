import type { AutomationDefinition, AutomationEdge, AutomationNode } from "./schema.js";

export interface AutomationValidationIssue {
  code:
    | "duplicate_node"
    | "duplicate_edge"
    | "missing_source"
    | "multiple_sources"
    | "missing_endpoint"
    | "cycle"
    | "unreachable"
    | "invalid_branch"
    | "duplicate_branch";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const branchesByNodeType: Record<AutomationNode["type"], ReadonlySet<AutomationEdge["branch"]>> = {
  source: new Set(["next"]),
  action: new Set(["next"]),
  delay: new Set(["next"]),
  condition: new Set(["yes", "no"]),
  decision: new Set(["yes", "no", "timeout"]),
};

export function validateAutomation(definition: AutomationDefinition): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = [];
  const nodes = new Map<string, AutomationNode>();
  const edgeIds = new Set<string>();

  for (const node of definition.nodes) {
    if (nodes.has(node.id)) {
      issues.push({
        code: "duplicate_node",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodes.set(node.id, node);
  }

  const sources = definition.nodes.filter((node) => node.type === "source");
  if (sources.length === 0) {
    issues.push({ code: "missing_source", message: "Automation requires one source node" });
  } else if (sources.length > 1) {
    issues.push({
      code: "multiple_sources",
      message: "Automation must have exactly one source node",
    });
  }

  const adjacency = new Map<string, string[]>();
  const outgoingBranches = new Set<string>();
  for (const node of definition.nodes) adjacency.set(node.id, []);

  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "duplicate_edge",
        message: `Duplicate edge id: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push({
        code: "missing_endpoint",
        message: `Edge ${edge.id} references a missing node`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!branchesByNodeType[source.type].has(edge.branch)) {
      issues.push({
        code: "invalid_branch",
        message: `Branch ${edge.branch} is invalid for ${source.type}`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
    const branchKey = `${source.id}:${edge.branch}`;
    if (outgoingBranches.has(branchKey)) {
      issues.push({
        code: "duplicate_branch",
        message: `Node ${source.id} has more than one ${edge.branch} branch`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
    outgoingBranches.add(branchKey);
    adjacency.get(source.id)?.push(target.id);
  }

  const sourceId = sources[0]?.id;
  if (sourceId) {
    const reachable = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        issues.push({
          code: "cycle",
          message: `Automation contains a cycle at ${nodeId}`,
          nodeId,
        });
        return;
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      reachable.add(nodeId);
      for (const child of adjacency.get(nodeId) ?? []) walk(child);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    walk(sourceId);
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "unreachable",
          message: `Node ${node.id} cannot be reached from the source`,
          nodeId: node.id,
        });
      }
    }
  }

  return deduplicateIssues(issues);
}

function deduplicateIssues(issues: AutomationValidationIssue[]): AutomationValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.nodeId ?? ""}:${issue.edgeId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function outgoingEdges(
  definition: AutomationDefinition,
  nodeId: string,
  branch?: AutomationEdge["branch"],
): AutomationEdge[] {
  return definition.edges.filter(
    (edge) => edge.source === nodeId && (branch === undefined || edge.branch === branch),
  );
}
