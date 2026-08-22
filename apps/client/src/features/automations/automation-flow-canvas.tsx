import { Background, Controls, MiniMap, Panel, ReactFlow } from "@xyflow/react";
import { Clock3, GitBranch, Mail, MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import type { AutomationDefinition } from "@openengage/core/automations";

import { automationNodeTypes } from "./automation-flow-node";
import { StepButton } from "./automation-flow-node";
import { NodeSettings } from "./automation-node-settings";
import type { AutomationOptions } from "./automation-types";
import { useAutomationBuilder } from "./use-automation-builder";

import "@xyflow/react/dist/style.css";

export default function AutomationFlowCanvas({
  definition,
  options,
  onDefinitionChange,
}: {
  definition: AutomationDefinition;
  options: AutomationOptions;
  onDefinitionChange: (definition: AutomationDefinition) => void;
}): ReactNode {
  const builder = useAutomationBuilder(definition, onDefinitionChange);
  const { selectedNode } = builder;

  function addNode(kind: "email" | "delay" | "decision" | "condition"): void {
    const result = builder.addNode(kind, options);
    if (result === "template_missing") {
      toast.error("先にメールテンプレートを作成してください");
      return;
    }
    toast.success(
      result === "connected" ? "ステップを追加して接続しました" : "ステップを追加しました",
    );
  }

  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[600px] grid-cols-[64px_minmax(0,1fr)] bg-muted/60 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-2 border-r bg-background p-2 lg:p-3">
        <div className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">
          ステップを追加
        </div>
        <StepButton icon={Mail} label="メール" onClick={() => addNode("email")} />
        <StepButton icon={Clock3} label="待機" onClick={() => addNode("delay")} />
        <StepButton
          icon={MousePointerClick}
          label="行動を待つ"
          onClick={() => addNode("decision")}
        />
        <StepButton icon={GitBranch} label="条件分岐" onClick={() => addNode("condition")} />
      </div>
      <ReactFlow
        nodes={builder.flowNodes}
        edges={builder.flowEdges}
        nodeTypes={automationNodeTypes}
        onNodesChange={builder.onNodesChange}
        onEdgesChange={builder.onEdgesChange}
        onConnect={(connection) => {
          if (builder.connect(connection)) toast.success("ノードを接続しました");
          else toast.error("循環する接続は作成できません");
        }}
        onNodeClick={(_, node) => builder.selectNode(node.id)}
        onPaneClick={() => builder.selectNode(null)}
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
          onUpdate={(update) => {
            if (selectedNode) builder.updateNode(selectedNode.id, update);
          }}
          onConnectionChange={(sourceId, branch, targetId) => {
            if (!builder.setConnection(sourceId, branch, targetId)) {
              toast.error("循環する接続は作成できません");
              return;
            }
            toast.success(targetId ? "接続先を更新しました" : "接続を解除しました");
          }}
          onDelete={builder.deleteSelectedNode}
        />
      </div>
    </div>
  );
}
