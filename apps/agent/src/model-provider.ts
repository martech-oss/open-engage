import {
  cloudflareBindingProvider,
  type CloudflareAIBinding,
} from "@flue/runtime/cloudflare/workers-ai";

const LUNA_ID = "openai/gpt-6-luna";

/** Add the new model until the Flue/Pi gateway catalog includes it. */
export function createAgentModelProvider(
  binding: CloudflareAIBinding,
): ReturnType<typeof cloudflareBindingProvider> {
  const provider = cloudflareBindingProvider({ binding });
  if (provider.getModels().some((model) => model.id === LUNA_ID)) return provider;

  const previousLuna = provider.getModels().find((model) => model.id === "openai/gpt-5.6-luna");
  if (!previousLuna) throw new Error("Cloudflare AI Gateway OpenAI Responses model is unavailable");

  const luna = {
    ...previousLuna,
    id: LUNA_ID,
    name: "GPT-6 Luna",
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    thinkingLevelMap: { ...previousLuna.thinkingLevelMap, off: "none" },
  };

  return { ...provider, getModels: () => [...provider.getModels(), luna] };
}
