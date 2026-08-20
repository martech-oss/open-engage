import type { GradingCriterionWrite, ScoringRuleWrite } from "@openengage/core/scoring";

import { gradingCriteria } from "./schema";

export const criterionSelection = {
  id: gradingCriteria.id,
  name: gradingCriteria.name,
  field: gradingCriteria.field,
  fieldKey: gradingCriteria.fieldKey,
  operator: gradingCriteria.operator,
  value: gradingCriteria.value,
  steps: gradingCriteria.steps,
  enabled: gradingCriteria.enabled,
  createdAt: gradingCriteria.createdAt,
  updatedAt: gradingCriteria.updatedAt,
};

export function ruleColumns(input: ScoringRuleWrite) {
  return {
    name: input.name,
    eventType: input.eventType,
    matchType: input.matchType,
    matchValue: input.matchValue,
    points: input.points,
    categoryId: input.categoryId,
    tagId: input.tagId,
    enabled: input.enabled,
  };
}

export function criterionColumns(input: GradingCriterionWrite) {
  return {
    name: input.name,
    field: input.field,
    fieldKey: input.fieldKey,
    operator: input.operator,
    value: input.value,
    steps: input.steps,
    enabled: input.enabled,
  };
}
