import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import type {
  GradingCriterion,
  ScoringCategory,
  ScoringRule,
  ScoringPageInput,
} from "@openengage/core/scoring";

export type { GradingCriterion, ScoringCategory, ScoringRule, ScoringPageInput };

export type ScoringRuleRow = ScoringRule;
export type ScoringCategoryRow = ScoringCategory;
export type GradingCriterionRow = GradingCriterion;

export function scoringRulesQueryOptions(input: ScoringPageInput = {}) {
  return orpcQuery.scoring.listRules.queryOptions({ input });
}

export function scoringCategoriesQueryOptions() {
  return orpcQuery.scoring.listCategories.queryOptions();
}

export function gradingCriteriaQueryOptions(input: ScoringPageInput = {}) {
  return orpcQuery.scoring.listCriteria.queryOptions({ input });
}

type QueryClient = ReturnType<typeof useQueryClient>;

function invalidate(queryClient: QueryClient, key: readonly unknown[]) {
  return () => queryClient.invalidateQueries({ queryKey: key });
}

export function useCreateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.createRule.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listRules.key()),
  });
}

export function useUpdateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.updateRule.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listRules.key()),
  });
}

export function useArchiveScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.archiveRule.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listRules.key()),
  });
}

export function useCreateScoringCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.createCategory.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listCategories.key()),
  });
}

export function useArchiveScoringCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.archiveCategory.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listCategories.key()),
  });
}

export function useCreateGradingCriterion() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.createCriterion.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listCriteria.key()),
  });
}

export function useUpdateGradingCriterion() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.updateCriterion.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listCriteria.key()),
  });
}

export function useArchiveGradingCriterion() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.scoring.archiveCriterion.mutationOptions(),
    onSuccess: invalidate(queryClient, orpcQuery.scoring.listCriteria.key()),
  });
}
