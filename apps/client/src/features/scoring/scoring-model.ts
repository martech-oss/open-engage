import type { GradingCriterionRow, ScoringRuleRow } from "./scoring-api";

export function summarizeScoringRules(rules: ScoringRuleRow[], categories: number) {
  return {
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled).length,
    pageActions: rules.filter((rule) => rule.eventType === "page_viewed").length,
    categories,
  };
}

export function summarizeGradingCriteria(criteria: GradingCriterionRow[]) {
  const enabled = criteria.filter((criterion) => criterion.enabled);
  return {
    enabled: enabled.length,
    totalSteps: enabled.reduce((sum, criterion) => sum + criterion.steps, 0),
  };
}
