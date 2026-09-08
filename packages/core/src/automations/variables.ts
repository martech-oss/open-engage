import {
  resolveVariableRef,
  resolveVariableText,
  variableRefSchema,
  variableTextReferences,
  type VariableRef,
  type VariableSnapshot,
} from "../projects/variables";
import {
  automationDefinitionSchema,
  type AutomationDefinition,
  type AutomationNode,
} from "./schema";

function supportedFields(node: AutomationNode): string[] {
  if (node.type === "delay") return node.config.mode === "absolute" ? ["at"] : ["minutes"];
  if (node.type === "decision") return ["withinMinutes"];
  if (node.type === "action") {
    if (node.config.action === "change_score") return ["amount"];
    if (node.config.action === "handoff_to_sales") return ["title"];
    if (node.config.action === "update_field") return ["value"];
  }
  return [];
}
export function automationVariableReferences(
  definition: AutomationDefinition,
  textReferences = variableTextReferences,
): VariableRef[] {
  return definition.nodes.flatMap((node) =>
    supportedFields(node).flatMap((key) => {
      const value = (node.config as Record<string, unknown>)[key];
      const ref = variableRefSchema.safeParse(value);
      return ref.success ? [ref.data] : typeof value === "string" ? textReferences(value) : [];
    }),
  );
}
/** Resolves only the explicit scalar allowlist; resource identifiers are never interpolated. */
export function resolveAutomationVariables(
  definition: AutomationDefinition,
  snapshot: VariableSnapshot,
): AutomationDefinition {
  const resolved = structuredClone(definition);
  for (const node of resolved.nodes)
    for (const field of supportedFields(node)) {
      const config = node.config as Record<string, unknown>,
        value = config[field],
        ref = variableRefSchema.safeParse(value);
      if (ref.success) config[field] = resolveVariableRef(ref.data, snapshot);
      else if (typeof value === "string") config[field] = resolveVariableText(value, snapshot);
    }
  return automationDefinitionSchema.parse(resolved);
}
export function automationNumber(value: number | VariableRef): number {
  if (typeof value !== "number") throw new Error("Automation variable has not been resolved");
  return value;
}
export function automationString(value: string | VariableRef): string {
  if (typeof value !== "string") throw new Error("Automation variable has not been resolved");
  return value;
}
