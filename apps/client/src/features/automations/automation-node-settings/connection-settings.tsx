import type { ReactNode } from "react";

import { FieldDescription, FieldSeparator } from "@/components/ui/field";
import type { AutomationEdge, AutomationNode } from "@openengage/core/automations";

import { connectionBranches } from "../automation-graph";
import { nodeLabel } from "../automation-labels";
import { SettingSelect } from "./fields";

export function ConnectionSettings({
  node,
  nodes,
  edges,
  onConnectionChange,
}: {
  node: AutomationNode;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  onConnectionChange: (
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ) => void;
}): ReactNode {
  const targets = nodes.filter((target) => target.id !== node.id && target.type !== "source");
  const branches = connectionBranches(node);
  return (
    <>
      <FieldSeparator>接続</FieldSeparator>
      <FieldDescription>
        キャンバス上で丸をドラッグするか、ここで次に実行するステップを選択できます。
      </FieldDescription>
      {branches.map(([branch, label]) => (
        <SettingSelect
          key={branch}
          label={branches.length === 1 ? "接続先" : `${label}の接続先`}
          value={
            edges.find((edge) => edge.source === node.id && edge.branch === branch)?.target ?? ""
          }
          onChange={(targetId) => onConnectionChange(node.id, branch, targetId)}
          options={[
            ["", "未接続"],
            ...targets.map(
              (target) =>
                [
                  target.id,
                  `${nodes.findIndex((candidate) => candidate.id === target.id) + 1}. ${nodeLabel(target)}`,
                ] as const,
            ),
          ]}
        />
      ))}
    </>
  );
}
