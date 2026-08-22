import { describe, expect, it } from "vitest";

import type { GradingCriterionRow, ScoringRuleRow } from "./scoring-api";
import { summarizeGradingCriteria, summarizeScoringRules } from "./scoring-model";

describe("scoring summaries", () => {
  it("counts enabled and page-view rules independently", () => {
    const rules = [
      rule({ id: "rule-1", enabled: true, eventType: "page_viewed" }),
      rule({ id: "rule-2", enabled: false, eventType: "page_viewed" }),
      rule({ id: "rule-3", enabled: true, eventType: "email_clicked" }),
    ];

    expect(summarizeScoringRules(rules, 4)).toEqual({
      total: 3,
      enabled: 2,
      pageActions: 2,
      categories: 4,
    });
  });

  it("excludes disabled criteria from the grade movement total", () => {
    const criteria = [
      criterion({ id: "criterion-1", enabled: true, steps: 3 }),
      criterion({ id: "criterion-2", enabled: false, steps: 6 }),
      criterion({ id: "criterion-3", enabled: true, steps: -1 }),
    ];

    expect(summarizeGradingCriteria(criteria)).toEqual({ enabled: 2, totalSteps: 2 });
  });
});

function rule(overrides: Partial<ScoringRuleRow>): ScoringRuleRow {
  return {
    id: "rule",
    name: "Rule",
    eventType: "custom_event",
    matchType: "any",
    matchValue: null,
    points: 5,
    categoryId: null,
    categoryName: null,
    tagId: null,
    tagName: null,
    enabled: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function criterion(overrides: Partial<GradingCriterionRow>): GradingCriterionRow {
  return {
    id: "criterion",
    name: "Criterion",
    field: "stage",
    fieldKey: null,
    operator: "eq",
    value: "qualified",
    steps: 1,
    enabled: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}
