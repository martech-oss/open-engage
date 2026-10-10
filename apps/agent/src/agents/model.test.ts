import { setProvider } from "@flue/runtime";
import type { CloudflareAIBinding } from "@flue/runtime/cloudflare/workers-ai";
import {
  hasProvider,
  registerDefaultProviders,
  resetModelsForTests,
  resolveModel,
} from "@flue/runtime/internal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentModelProvider } from "../model-provider";
import { AGENT_MODEL, setAgentModel } from "./model";

const defaultModel = AGENT_MODEL;

beforeEach(() => {
  resetModelsForTests();
  setAgentModel(defaultModel);
});

afterEach(() => {
  resetModelsForTests();
  setAgentModel(defaultModel);
});

describe("agent model configuration", () => {
  it("resolves the direct-run default through built-in providers without app.ts", () => {
    registerDefaultProviders();

    expect(AGENT_MODEL).toBe("anthropic/claude-haiku-4-5");
    expect(resolveModel(AGENT_MODEL)).toMatchObject({
      provider: "anthropic",
      id: "claude-haiku-4-5",
    });
    expect(hasProvider("cloudflare")).toBe(false);
  });

  it("updates an already imported model binding to the registered Workers catalog", () => {
    const run = vi.fn<CloudflareAIBinding["run"]>();
    const provider = createAgentModelProvider({ run });

    expect(AGENT_MODEL).toBe("anthropic/claude-haiku-4-5");
    setProvider(provider);
    setAgentModel("cloudflare/openai/gpt-6-luna");

    expect(AGENT_MODEL).toBe("cloudflare/openai/gpt-6-luna");
    expect(resolveModel(AGENT_MODEL)).toEqual(
      provider.getModels().find((model) => model.id === "openai/gpt-6-luna"),
    );
    expect(run).not.toHaveBeenCalled();
  });
});
