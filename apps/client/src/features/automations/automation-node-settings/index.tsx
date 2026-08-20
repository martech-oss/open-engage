import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { AutomationEdge, AutomationNode } from "@openengage/core/automations";

import { nodeLabel, nodeTypeLabel } from "../automation-labels";
import type { AutomationOptions } from "../automation-types";
import { ActionSettings } from "./action-settings";
import { ConnectionSettings } from "./connection-settings";
import { ConditionSettings, DecisionSettings, DelaySettings } from "./control-settings";
import type { NodeUpdate } from "./node-config";
import { SourceSettings } from "./source-settings";

export function NodeSettings({
  node,
  nodes,
  edges,
  options,
  onUpdate,
  onConnectionChange,
  onDelete,
}: {
  node: AutomationNode | null;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  options: AutomationOptions;
  onUpdate: NodeUpdate;
  onConnectionChange: (
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ) => void;
  onDelete: () => void;
}): ReactNode {
  if (!node) {
    return (
      <div className="p-6 text-sm leading-6 text-muted-foreground">
        キャンバス上のステップを選択すると、ここで開始条件や実行内容を設定できます。
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {nodeTypeLabel(node.type)}
          </div>
          <h2 className="mt-1 font-medium">{nodeLabel(node)}</h2>
        </div>
        {node.type !== "source" ? (
          <Button size="icon-sm" variant="ghost" aria-label="ステップを削除" onClick={onDelete}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      {node.type === "source" ? (
        <SourceSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "action" ? (
        <ActionSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "delay" ? <DelaySettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "decision" ? <DecisionSettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "condition" ? <ConditionSettings node={node} onUpdate={onUpdate} /> : null}
      <ConnectionSettings
        node={node}
        nodes={nodes}
        edges={edges}
        onConnectionChange={onConnectionChange}
      />
    </div>
  );
}

export { ConnectionSettings } from "./connection-settings";
