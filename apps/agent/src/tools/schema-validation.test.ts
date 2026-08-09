import { describe, expect, it } from "vitest";

import {
  validateAutomationDefinitionInput,
  validateEmailSequenceProposalInput,
  validateSegmentFilterInput,
} from "./schema-validation";

const position = { x: 0, y: 0 };

function automation(nodes: unknown[], edges: unknown[]) {
  return {
    name: "Trial onboarding",
    description: "Move new trial contacts toward first value.",
    timezone: "UTC",
    nodes,
    edges,
  };
}

describe("validateSegmentFilterInput", () => {
  it("normalizes a valid nested filter", () => {
    const result = validateSegmentFilterInput({
      kind: "group",
      combinator: "and",
      children: [
        { kind: "condition", field: "status", operator: "eq", value: "active" },
        {
          kind: "group",
          combinator: "or",
          children: [
            { kind: "condition", field: "score", operator: "gte", value: 50 },
            {
              kind: "condition",
              field: "event",
              key: "trial_activated",
              operator: "exists",
              value: null,
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({ valid: true, normalized: { kind: "group" } });
  });

  it("rejects an operator unsupported by the selected field", () => {
    const result = validateSegmentFilterInput({
      kind: "condition",
      field: "score",
      operator: "contains",
      value: 5,
    });

    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "$.operator" })]),
    });
  });

  it("rejects a keyed field without its key", () => {
    const result = validateSegmentFilterInput({
      kind: "condition",
      field: "event",
      operator: "exists",
      value: null,
    });

    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "$.key" })]),
    });
  });

  it("rejects an empty group", () => {
    const result = validateSegmentFilterInput({
      kind: "group",
      combinator: "and",
      children: [],
    });

    expect(result).toMatchObject({ valid: false });
  });
});

describe("validateAutomationDefinitionInput", () => {
  const source = {
    id: "source-1",
    type: "source",
    position,
    config: { source: "contact_created", reentry: "once" },
  };
  const action = {
    id: "action-1",
    type: "action",
    position: { x: 320, y: 0 },
    config: { action: "change_score", amount: 10 },
  };

  it("normalizes a valid definition", () => {
    const result = validateAutomationDefinitionInput(
      automation(
        [source, action],
        [{ id: "edge-1", source: source.id, target: action.id, branch: "next" }],
      ),
    );

    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it("reports schema failures", () => {
    const result = validateAutomationDefinitionInput(automation([], []));

    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ phase: "schema" })]),
    });
  });

  it("reports a missing source", () => {
    const result = validateAutomationDefinitionInput(automation([action], []));

    expect(issueCodes(result)).toContain("missing_source");
  });

  it("reports multiple sources", () => {
    const secondSource = { ...source, id: "source-2" };
    const result = validateAutomationDefinitionInput(automation([source, secondSource], []));

    expect(issueCodes(result)).toContain("multiple_sources");
  });

  it("reports a cycle", () => {
    const result = validateAutomationDefinitionInput(
      automation(
        [source, action],
        [
          { id: "edge-1", source: source.id, target: action.id, branch: "next" },
          { id: "edge-2", source: action.id, target: source.id, branch: "next" },
        ],
      ),
    );

    expect(issueCodes(result)).toContain("cycle");
  });

  it("reports an unreachable node", () => {
    const result = validateAutomationDefinitionInput(automation([source, action], []));

    expect(issueCodes(result)).toContain("unreachable");
  });

  it("reports an invalid branch", () => {
    const result = validateAutomationDefinitionInput(
      automation(
        [source, action],
        [{ id: "edge-1", source: source.id, target: action.id, branch: "yes" }],
      ),
    );

    expect(issueCodes(result)).toContain("invalid_branch");
  });

  it("reports a missing edge endpoint", () => {
    const result = validateAutomationDefinitionInput(
      automation(
        [source],
        [{ id: "edge-1", source: source.id, target: "missing-node", branch: "next" }],
      ),
    );

    expect(issueCodes(result)).toContain("missing_endpoint");
  });

  it("reports duplicate outgoing branches", () => {
    const secondAction = { ...action, id: "action-2" };
    const result = validateAutomationDefinitionInput(
      automation(
        [source, action, secondAction],
        [
          { id: "edge-1", source: source.id, target: action.id, branch: "next" },
          { id: "edge-2", source: source.id, target: secondAction.id, branch: "next" },
        ],
      ),
    );
    expect(issueCodes(result)).toContain("duplicate_branch");
  });
});

describe("validateEmailSequenceProposalInput", () => {
  it("reports schema issues before sequence validation", () => {
    const result = validateEmailSequenceProposalInput({ emails: [] });
    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ phase: "schema" })]),
    });
  });
});

function issueCodes(result: ReturnType<typeof validateAutomationDefinitionInput>): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}
