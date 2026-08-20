import { describe, expect, it } from "vitest";

import { type AiRequestKeyPart, createAiProposalWorkflowKey } from "./use-ai-proposal-workflow";

describe("createAiProposalWorkflowKey", () => {
  it("serializes tuple boundaries without colon collisions", () => {
    expect(createAiProposalWorkflowKey(["a:b", "c"])).not.toBe(
      createAiProposalWorkflowKey(["a", "b:c"]),
    );
  });

  it("preserves the existing primitive tuple encoding", () => {
    expect(createAiProposalWorkflowKey(["segment", "create", null, undefined, 2, true, -0])).toBe(
      '["tuple",[["string","segment"],["string","create"],["null"],["undefined"],["number","2"],["boolean","true"],["number","-0"]]]',
    );
  });

  it.each([
    ["plain object", { revision: 2 }],
    ["nested object", ["segment", { revision: 2 }]],
    ["date", new Date("2026-01-01T00:00:00.000Z")],
    ["map", new Map([["revision", 2]])],
    ["set", new Set([2])],
    ["bigint", 2n],
  ])("rejects an unsupported %s key part", (_name, value) => {
    expect(() => createAiProposalWorkflowKey([value as unknown as AiRequestKeyPart])).toThrowError(
      /primitive string, number, boolean, null, or undefined/,
    );
  });

  it("rejects cyclic structures without recursing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => createAiProposalWorkflowKey([cyclic as unknown as AiRequestKeyPart])).toThrowError(
      /primitive string, number, boolean, null, or undefined/,
    );
  });
});
