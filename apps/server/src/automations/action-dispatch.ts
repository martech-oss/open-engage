import type { AutomationNode } from "@openengage/core/automations";

import { PermanentChannelError } from "../channels";

export type AutomationAction = Extract<AutomationNode, { type: "action" }>["config"];
export type AutomationActionKind = AutomationAction["action"];

export type AutomationActionExecutorRegistry<TContext> = {
  [TKind in AutomationActionKind]: (
    action: Extract<AutomationAction, { action: TKind }>,
    context: TContext,
  ) => Promise<void>;
};

/**
 * Dispatches persisted automation actions through a compile-time exhaustive registry.
 * The runtime guard protects workers from silently accepting corrupt or future data.
 */
export async function dispatchAutomationAction<TContext>(
  registry: AutomationActionExecutorRegistry<TContext>,
  action: AutomationAction,
  context: TContext,
): Promise<void> {
  const executor = registry[action.action] as
    | ((action: AutomationAction, context: TContext) => Promise<void>)
    | undefined;
  if (!executor) {
    throw new PermanentChannelError(`Unsupported automation action: ${String(action.action)}`);
  }
  await executor(action, context);
}
