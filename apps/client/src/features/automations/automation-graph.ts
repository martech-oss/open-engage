import {
  type AutomationDefinition,
  type AutomationEdge,
  type AutomationNode,
} from "@openengage/core/automations";

import { type EmailTemplateOption } from "./automation-types";

export function chainEdges(ids: string[]): AutomationEdge[] {
  return ids.slice(1).map((target, index) => ({
    id: `${ids[index]}-${target}`,
    source: ids[index]!,
    target,
    branch: "next",
  }));
}

export function connectionBranches(
  node: AutomationNode,
): Array<readonly [AutomationEdge["branch"], string]> {
  if (node.type === "condition") {
    return [
      ["yes", "はい"],
      ["no", "いいえ"],
    ];
  }
  if (node.type === "decision") {
    return [
      ["yes", "はい"],
      ["timeout", "時間切れ"],
    ];
  }
  return [["next", "次へ"]];
}

export function withAutomationConnection(
  definition: AutomationDefinition,
  sourceId: string,
  targetId: string | null,
  branch: AutomationEdge["branch"],
): AutomationDefinition | null {
  const source = definition.nodes.find((node) => node.id === sourceId);
  const target = targetId
    ? definition.nodes.find((node) => node.id === targetId && node.type !== "source")
    : null;
  if (
    !source ||
    (targetId && !target) ||
    !connectionBranches(source).some(([candidate]) => candidate === branch)
  ) {
    return null;
  }

  const existing = definition.edges.find(
    (edge) => edge.source === sourceId && edge.branch === branch,
  );
  const edges = definition.edges.filter(
    (edge) => !(edge.source === sourceId && edge.branch === branch),
  );
  if (!targetId) return { ...definition, edges };
  if (connectionCreatesCycle(edges, sourceId, targetId)) return null;

  return {
    ...definition,
    edges: [
      ...edges,
      {
        id: existing?.id ?? crypto.randomUUID(),
        source: sourceId,
        target: targetId,
        branch,
      },
    ],
  };
}

export function connectionCreatesCycle(
  edges: AutomationEdge[],
  sourceId: string,
  targetId: string,
): boolean {
  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.source === current) pending.push(edge.target);
    }
  }
  return false;
}

export function isBranch(value: string | null | undefined): value is AutomationEdge["branch"] {
  return value === "next" || value === "yes" || value === "no" || value === "timeout";
}

export interface AutomationFlowEdge {
  data?: Record<string, unknown>;
  id: string;
  source: string;
  target: string;
}

export function toAutomationEdge(edge: AutomationFlowEdge): AutomationEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    branch: isBranch(edge.data?.["branch"] as string | undefined)
      ? (edge.data?.["branch"] as AutomationEdge["branch"])
      : "next",
  };
}

export function sourceNode(
  config: Extract<AutomationNode, { type: "source" }>["config"],
  x: number,
  y: number,
): Extract<AutomationNode, { type: "source" }> {
  return { id: "source", type: "source", position: { x, y }, config };
}

export function emailNode(
  id: string,
  position: { x: number; y: number },
  template: EmailTemplateOption,
): Extract<AutomationNode, { type: "action" }> {
  return {
    id,
    type: "action",
    position,
    config: {
      action: "send_email",
      templateId: template.id,
    },
  };
}

export function delayNode(
  id: string,
  minutes: number,
  x: number,
  y: number,
): Extract<AutomationNode, { type: "delay" }> {
  return { id, type: "delay", position: { x, y }, config: { mode: "relative", minutes } };
}

export function sourceConfig(
  source: string,
  formId: string,
  segmentId: string,
): Extract<AutomationNode, { type: "source" }>["config"] {
  if (source === "batch")
    return {
      source,
      reentry: "once",
      audience: {
        kind: "filter",
        filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
      },
      schedule: { kind: "now" },
    };
  if (source === "callable") return { source, reentry: "every_time" };
  if (
    source === "project_member_joined" ||
    source === "project_member_progressed" ||
    source === "project_member_succeeded"
  )
    return { source, projectId: "", reentry: "every_time" };
  if (source === "form_submitted") return { source, formId, reentry: "once" };
  if (source === "segment_joined") return { source, segmentId, reentry: "once" };
  if (source === "api_event") return { source, eventName: "custom_event", reentry: "every_time" };
  if (source === "webhook_event")
    return { source, eventName: "custom_event", reentry: "every_time" };
  if (source === "contact_inactive") return { source, days: 30, reentry: "once" };
  return { source: "contact_created", reentry: "once" };
}
