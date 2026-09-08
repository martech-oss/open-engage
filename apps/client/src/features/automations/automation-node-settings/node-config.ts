import type { AutomationNode } from "@openengage/core/automations";

type SourceNodeConfig = Extract<AutomationNode, { type: "source" }>["config"];
type ActionNodeConfig = Extract<AutomationNode, { type: "action" }>["config"];

export type NodeUpdate = (update: (node: AutomationNode) => AutomationNode) => void;

export function nodeTypeIs<TType extends AutomationNode["type"]>(
  type: TType,
): (node: AutomationNode) => node is Extract<AutomationNode, { type: TType }> {
  return (node): node is Extract<AutomationNode, { type: TType }> => node.type === type;
}

export function sourceIs<TSource extends SourceNodeConfig["source"]>(
  source: TSource,
): (node: AutomationNode) => node is Extract<AutomationNode, { type: "source" }> & {
  config: Extract<SourceNodeConfig, { source: TSource }>;
} {
  return (
    node,
  ): node is Extract<AutomationNode, { type: "source" }> & {
    config: Extract<SourceNodeConfig, { source: TSource }>;
  } => node.type === "source" && node.config.source === source;
}

export function actionIs<TAction extends ActionNodeConfig["action"]>(
  action: TAction,
): (node: AutomationNode) => node is Extract<AutomationNode, { type: "action" }> & {
  config: Extract<ActionNodeConfig, { action: TAction }>;
} {
  return (
    node,
  ): node is Extract<AutomationNode, { type: "action" }> & {
    config: Extract<ActionNodeConfig, { action: TAction }>;
  } => node.type === "action" && node.config.action === action;
}

export function patchNodeConfig<TNode extends AutomationNode>(
  onUpdate: NodeUpdate,
  isMatch: (node: AutomationNode) => node is TNode,
  patch: (config: TNode["config"]) => Partial<TNode["config"]>,
): void {
  onUpdate((current) =>
    isMatch(current)
      ? { ...current, config: { ...current.config, ...patch(current.config) } }
      : current,
  );
}
