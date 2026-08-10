import { describe, expect, it } from "vitest";

import { createAiProposalWorkflowKey } from "./use-ai-proposal-workflow";

describe("createAiProposalWorkflowKey", () => {
  it("changes when the entity or approved revision changes", () => {
    const base = { resource: "automation", mode: "refine", entityId: "a" } as const;
    expect(createAiProposalWorkflowKey(base)).not.toBe(
      createAiProposalWorkflowKey({ ...base, entityId: "b" }),
    );
    expect(createAiProposalWorkflowKey({ ...base, projectId: "p", briefRevision: 1 })).not.toBe(
      createAiProposalWorkflowKey({ ...base, projectId: "p", briefRevision: 2 }),
    );
  });

  it("keeps standalone create workflows deterministic", () => {
    expect(createAiProposalWorkflowKey({ resource: "segment", mode: "create" })).toBe(
      "segment:create:new:standalone:none",
    );
  });
});
