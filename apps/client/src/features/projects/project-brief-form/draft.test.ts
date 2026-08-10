import { describe, expect, it } from "vitest";

import {
  emptyBrief,
  mergeAiProposalPreservingEdits,
  projectBriefDraftReducer,
  toLocalDateTime,
  validateProjectBriefDraft,
} from "./draft";

describe("project brief form draft", () => {
  it("keeps an empty datetime as form state and reports a field error instead of throwing", () => {
    const draft = projectBriefDraftReducer(emptyBrief(), {
      type: "set",
      value: (current) => ({ ...current, reviewAt: "" }),
    });

    const result = validateProjectBriefDraft(draft);
    expect(result.success).toBe(false);
    expect(result.errors.reviewAt).toContain("レビュー日時");
    expect(toLocalDateTime("")).toBe("");
  });

  it("preserves in-flight manual edits for create and refine AI proposals", () => {
    const before = emptyBrief();
    before.name = "Before";
    before.definition.outcome = "Before outcome";
    const current = {
      ...before,
      name: "Manual edit",
      definition: { ...before.definition, outcome: "Before outcome" },
    };
    const proposal = {
      ...before,
      name: "AI name",
      description: "AI description",
      definition: { ...before.definition, outcome: "AI outcome" },
    };

    const merged = mergeAiProposalPreservingEdits(current, before, proposal);
    expect(merged.name).toBe("Manual edit");
    expect(merged.description).toBe("AI description");
    expect(merged.definition.outcome).toBe("AI outcome");
  });
});
