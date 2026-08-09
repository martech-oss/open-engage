import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Mail } from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type AutomationNode } from "@openengage/core/automations";

import { nodeLabel, nodeTypeLabel } from "./automation-labels";

export function nodeHandles(node: AutomationNode): NonNullable<Node["handles"]> {
  const height = node.type === "decision" || node.type === "condition" ? 82 : 70;
  const target =
    node.type === "source"
      ? []
      : [
          {
            id: null,
            type: "target" as const,
            position: Position.Left,
            x: -8,
            y: height / 2 - 8,
            width: 16,
            height: 16,
          },
        ];
  if (node.type === "condition") {
    return [
      ...target,
      {
        id: "yes",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.35 - 8,
        width: 16,
        height: 16,
      },
      {
        id: "no",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.72 - 8,
        width: 16,
        height: 16,
      },
    ];
  }
  if (node.type === "decision") {
    return [
      ...target,
      {
        id: "yes",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.28 - 8,
        width: 16,
        height: 16,
      },
      {
        id: "timeout",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.72 - 8,
        width: 16,
        height: 16,
      },
    ];
  }
  return [
    ...target,
    {
      id: null,
      type: "source",
      position: Position.Right,
      x: 172,
      y: height / 2 - 8,
      width: 16,
      height: 16,
    },
  ];
}

function AutomationFlowNode({
  data,
  selected,
}: NodeProps<Node<{ node: AutomationNode }>>): ReactNode {
  const node = data.node;
  const colors: Record<AutomationNode["type"], string> = {
    source: "border-success",
    action: "border-primary",
    condition: "border-warning",
    decision: "border-chart-4",
    delay: "border-muted-foreground",
  };
  return (
    <Card
      size="sm"
      className={cn(
        "min-w-44 border-2 py-3 shadow-md transition-shadow",
        colors[node.type],
        selected && "ring-4 ring-primary/20",
      )}
    >
      {node.type !== "source" ? (
        <Handle
          type="target"
          position={Position.Left}
          title="ここへ接続"
          className="size-4! border-[3px]! border-background! bg-muted-foreground! shadow-sm"
        />
      ) : null}
      <CardHeader>
        <CardDescription className="text-[10px] font-semibold tracking-widest uppercase">
          {nodeTypeLabel(node.type)}
        </CardDescription>
        <CardTitle>{nodeLabel(node)}</CardTitle>
      </CardHeader>
      {node.type === "condition" ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            title="「はい」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "35%" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            title="「いいえ」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "72%" }}
          />
        </>
      ) : node.type === "decision" ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            title="「はい」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "28%" }}
          />
          <Handle
            id="timeout"
            type="source"
            position={Position.Right}
            title="「時間切れ」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "72%" }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          title="ここから接続"
          className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
        />
      )}
    </Card>
  );
}

export const automationNodeTypes = { automation: AutomationFlowNode };

export function StepButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Mail;
  label: string;
  onClick: () => void;
}): ReactNode {
  return (
    <Button
      variant="ghost"
      className="h-auto flex-col gap-1 px-1 py-2 text-[10px] lg:flex-row lg:justify-start lg:gap-2 lg:px-2 lg:text-sm"
      onClick={onClick}
    >
      <Icon />
      <span>{label}</span>
    </Button>
  );
}
