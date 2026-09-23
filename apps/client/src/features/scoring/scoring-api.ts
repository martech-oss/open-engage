import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import type {
  GradingCriterion,
  ScoringCategory,
  ScoringRule,
  ScoringPageInput,
} from "@openengage/core/scoring";

export type { GradingCriterion, ScoringCategory, ScoringRule, ScoringPageInput };

export function scoringRulesQueryOptions(input: ScoringPageInput = {}) {
  return orpcQuery.scoring.listRules.queryOptions({ input });
}

export function scoringCategoriesQueryOptions() {
  return orpcQuery.scoring.listCategories.queryOptions();
}

export function gradingCriteriaQueryOptions(input: ScoringPageInput = {}) {
  return orpcQuery.scoring.listCriteria.queryOptions({ input });
}

export function useCreateScoringRule() {
  return useInvalidatingMutation(orpcQuery.scoring.createRule.mutationOptions(), [
    orpcQuery.scoring.listRules.key(),
  ]);
}

export function useUpdateScoringRule() {
  return useInvalidatingMutation(orpcQuery.scoring.updateRule.mutationOptions(), [
    orpcQuery.scoring.listRules.key(),
  ]);
}

export function useArchiveScoringRule() {
  return useInvalidatingMutation(orpcQuery.scoring.archiveRule.mutationOptions(), [
    orpcQuery.scoring.listRules.key(),
  ]);
}

export function useCreateScoringCategory() {
  return useInvalidatingMutation(orpcQuery.scoring.createCategory.mutationOptions(), [
    orpcQuery.scoring.listCategories.key(),
  ]);
}

export function useArchiveScoringCategory() {
  return useInvalidatingMutation(orpcQuery.scoring.archiveCategory.mutationOptions(), [
    orpcQuery.scoring.listCategories.key(),
  ]);
}

export function useCreateGradingCriterion() {
  return useInvalidatingMutation(orpcQuery.scoring.createCriterion.mutationOptions(), [
    orpcQuery.scoring.listCriteria.key(),
  ]);
}

export function useUpdateGradingCriterion() {
  return useInvalidatingMutation(orpcQuery.scoring.updateCriterion.mutationOptions(), [
    orpcQuery.scoring.listCriteria.key(),
  ]);
}

export function useArchiveGradingCriterion() {
  return useInvalidatingMutation(orpcQuery.scoring.archiveCriterion.mutationOptions(), [
    orpcQuery.scoring.listCriteria.key(),
  ]);
}
