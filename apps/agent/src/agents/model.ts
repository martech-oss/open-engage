// Direct agent runs use the built-in Node provider; app.ts configures Workers.
export let AGENT_MODEL = "anthropic/claude-haiku-4-5";

export function setAgentModel(model: string) {
  AGENT_MODEL = model;
}
