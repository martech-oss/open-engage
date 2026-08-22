import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import type {
  AutomationDefinition,
  AutomationEdge,
  AutomationNode,
} from "@openengage/core/automations";

import { nodeHandles } from "./automation-flow-node";
import {
  connectionBranches,
  isBranch,
  toAutomationEdge,
  withAutomationConnection,
} from "./automation-graph";
import { emailNode } from "./automation-graph";
import { branchLabel } from "./automation-labels";
import type { AutomationOptions } from "./automation-types";

interface AutomationBuilderState {
  definition: AutomationDefinition;
  selectedNodeId: string | null;
}

type AutomationBuilderAction =
  | { type: "replace_definition"; definition: AutomationDefinition }
  | { type: "select_node"; nodeId: string | null }
  | { type: "reset_for_entity"; definition: AutomationDefinition }
  | { type: "replace_and_select"; definition: AutomationDefinition; nodeId: string | null };

export function automationBuilderReducer(
  state: AutomationBuilderState,
  action: AutomationBuilderAction,
): AutomationBuilderState {
  switch (action.type) {
    case "replace_definition":
      return { ...state, definition: action.definition };
    case "select_node":
      return { ...state, selectedNodeId: action.nodeId };
    case "reset_for_entity":
      return {
        definition: action.definition,
        selectedNodeId: action.definition.nodes[0]?.id ?? null,
      };
    case "replace_and_select":
      return { definition: action.definition, selectedNodeId: action.nodeId };
  }
}

export function useAutomationBuilder(
  definition: AutomationDefinition,
  onDefinitionChange: (definition: AutomationDefinition) => void,
) {
  const [selectedNodeId, setSelectedNodeId] = useState(definition.nodes[0]?.id ?? null);
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const flowNodes: Node[] = useMemo(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        type: "automation",
        initialWidth: 180,
        initialHeight: node.type === "decision" || node.type === "condition" ? 82 : 70,
        handles: nodeHandles(node),
        selected: node.id === selectedNodeId,
        data: { node },
      })),
    [definition.nodes, selectedNodeId],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      definition.edges.map((edge) => {
        const label = branchLabel(edge.branch);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(edge.branch === "next" ? {} : { sourceHandle: edge.branch }),
          ...(label ? { label } : {}),
          data: { branch: edge.branch },
        };
      }),
    [definition.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const changed = applyNodeChanges(changes, flowNodes);
      onDefinitionChange({
        ...definition,
        nodes: definition.nodes.map((node) => {
          const flow = changed.find((item) => item.id === node.id);
          return flow ? { ...node, position: flow.position } : node;
        }),
      });
    },
    [definition, flowNodes, onDefinitionChange],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const changed = applyEdgeChanges(changes, flowEdges);
      onDefinitionChange({ ...definition, edges: changed.map(toAutomationEdge) });
    },
    [definition, flowEdges, onDefinitionChange],
  );

  function connect(connection: Connection): boolean {
    if (!connection.source || !connection.target) return false;
    const branch = isBranch(connection.sourceHandle) ? connection.sourceHandle : "next";
    const next = withAutomationConnection(definition, connection.source, connection.target, branch);
    if (!next) return false;
    onDefinitionChange(next);
    return true;
  }

  function updateNode(nodeId: string, update: (node: AutomationNode) => AutomationNode): void {
    onDefinitionChange({
      ...definition,
      nodes: definition.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
    });
  }

  function addNode(
    kind: "email" | "delay" | "decision" | "condition",
    options: AutomationOptions,
  ): "template_missing" | "connected" | "unconnected" {
    const id = crypto.randomUUID();
    const position = { x: 360, y: 120 + definition.nodes.length * 70 };
    let node: AutomationNode;
    if (kind === "email") {
      const template = options.templates.find((candidate) => candidate.sendable);
      if (!template) return "template_missing";
      node = emailNode(id, position, template);
    } else if (kind === "delay") {
      node = { id, type: "delay", position, config: { mode: "relative", minutes: 1_440 } };
    } else if (kind === "decision") {
      node = {
        id,
        type: "decision",
        position,
        config: { event: "opened", withinMinutes: 1_440 },
      };
    } else {
      node = {
        id,
        type: "condition",
        position,
        config: { field: "stage", operator: "eq", value: "customer" },
      };
    }
    const freeBranch = selectedNode
      ? connectionBranches(selectedNode).find(
          ([branch]) =>
            !definition.edges.some(
              (edge) => edge.source === selectedNode.id && edge.branch === branch,
            ),
        )?.[0]
      : undefined;
    onDefinitionChange({
      ...definition,
      nodes: [...definition.nodes, node],
      edges:
        selectedNode && freeBranch
          ? [
              ...definition.edges,
              {
                id: crypto.randomUUID(),
                source: selectedNode.id,
                target: node.id,
                branch: freeBranch,
              },
            ]
          : definition.edges,
    });
    setSelectedNodeId(id);
    return freeBranch ? "connected" : "unconnected";
  }

  function setConnection(
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ): boolean {
    const next = withAutomationConnection(definition, sourceId, targetId || null, branch);
    if (!next) return false;
    onDefinitionChange(next);
    return true;
  }

  function deleteSelectedNode(): void {
    if (!selectedNode || selectedNode.type === "source") return;
    onDefinitionChange({
      ...definition,
      nodes: definition.nodes.filter((node) => node.id !== selectedNode.id),
      edges: definition.edges.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    });
    setSelectedNodeId(null);
  }

  return {
    definition,
    selectedNode,
    selectedNodeId,
    flowNodes,
    flowEdges,
    onNodesChange,
    onEdgesChange,
    connect,
    updateNode,
    addNode,
    setConnection,
    deleteSelectedNode,
    selectNode: setSelectedNodeId,
  };
}
