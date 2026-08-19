import { describe, expect, it } from "vitest";

import { createAiProposalWorkflowKey } from "./use-ai-proposal-workflow";

describe("createAiProposalWorkflowKey", () => {
  it("serializes tuple boundaries without colon collisions", () => {
    expect(createAiProposalWorkflowKey(["a:b", "c"])).not.toBe(
      createAiProposalWorkflowKey(["a", "b:c"]),
    );
  });

  it("keeps the same opaque tuple deterministic", () => {
    expect(createAiProposalWorkflowKey(["segment", "create", null, { revision: 2 }])).toBe(
      createAiProposalWorkflowKey(["segment", "create", null, { revision: 2 }]),
    );
  });
});
