import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { AutomationDefinition, AutomationNode } from "@openengage/core/automations";

import { automationNodeTypes } from "./automation-flow-node";
import { NodeSettings } from "./automation-node-settings";
import type { AutomationOptions } from "./automation-types";

export default function AutomationFlowCanvas({
  flowNodes,
  flowEdges,
  definition,
  selectedNode,
  options,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onUpdateNode,
  onConnectionChange,
  onDelete,
}: {
  flowNodes: Node[];
  flowEdges: Edge[];
  definition: AutomationDefinition;
  selectedNode: AutomationNode | null;
  options: AutomationOptions;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNode: (update: (node: AutomationNode) => AutomationNode) => void;
  onConnectionChange: (
    sourceId: string,
    branch: AutomationDefinition["edges"][number]["branch"],
    targetId: string,
  ) => void;
  onDelete: () => void;
}): ReactNode {
  return (
    <>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={automationNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        deleteKeyCode={null}
      >
        <Background color="var(--color-border)" gap={24} />
        <Panel position="top-center">
          <Badge variant="secondary" className="shadow-sm">
            右端の丸から、次のノードの左端の丸へドラッグして接続
          </Badge>
        </Panel>
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      <div className="hidden overflow-y-auto border-l bg-background lg:block">
        <NodeSettings
          node={selectedNode}
          nodes={definition.nodes}
          edges={definition.edges}
          options={options}
          onUpdate={onUpdateNode}
          onConnectionChange={onConnectionChange}
          onDelete={onDelete}
        />
      </div>
    </>
  );
}
