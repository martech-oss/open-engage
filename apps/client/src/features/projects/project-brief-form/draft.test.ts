import { describe, expect, it } from "vitest";

import {
  emptyBrief,
  formDraftFromInput,
  mergeAiProposalPreservingEdits,
  projectBriefDraftReducer,
  validateProjectBriefDraft,
} from "./draft";

describe("project brief form draft", () => {
  it("keeps an empty datetime as form state and reports a field error instead of throwing", () => {
    const draft = projectBriefDraftReducer(emptyBrief("UTC"), {
      type: "set",
      value: (current) => ({ ...current, reviewAt: "" }),
    });

    const result = validateProjectBriefDraft(draft, "UTC");
    expect(result.success).toBe(false);
    expect(result.errors.reviewAt).toContain("レビュー日時");
  });

  it("edits the review time in the workspace timezone, not the browser's", () => {
    const base = fillBlanks(emptyBrief("UTC"));
    const draft = formDraftFromInput(
      { ...base, approverUserId: "approver", reviewAt: "2026-10-01T00:00:00.000Z" },
      "Asia/Tokyo",
    );
    expect(draft.reviewAt).toBe("2026-10-01T09:00");

    const edited = { ...draft, reviewAt: "2026-10-02T09:30" };
    const result = validateProjectBriefDraft(edited, "Asia/Tokyo");
    expect(result.success && result.data.reviewAt).toBe("2026-10-02T00:30:00.000Z");
  });

  it("preserves in-flight manual edits for create and refine AI proposals", () => {
    const before = emptyBrief("UTC");
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

/** Replaces every empty string so the draft passes the brief schema's required-text rules. */
function fillBlanks<T>(value: T): T {
  if (value === "") return "filled" as T;
  if (Array.isArray(value)) return value.map(fillBlanks) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, fillBlanks(entry)]),
    ) as T;
  }
  return value;
}
