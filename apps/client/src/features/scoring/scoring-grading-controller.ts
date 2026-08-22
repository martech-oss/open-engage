import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/hooks/use-form-submission";
import { useResourceEditor } from "@/hooks/use-resource-editor";

import {
  gradingCriteriaQueryOptions,
  type GradingCriterionRow,
  scoringCategoriesQueryOptions,
  type ScoringCategoryRow,
  useArchiveGradingCriterion,
  useArchiveScoringCategory,
} from "./scoring-api";
import { summarizeGradingCriteria } from "./scoring-model";

export function useScoringGradingController() {
  const { data: criteria } = useSuspenseQuery(gradingCriteriaQueryOptions());
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const resourceEditor = useResourceEditor<GradingCriterionRow>();
  const [criterionSessionId, setCriterionSessionId] = useState(0);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categorySessionId, setCategorySessionId] = useState(0);
  const archiveCriterionMutation = useArchiveGradingCriterion();
  const archiveCategoryMutation = useArchiveScoringCategory();

  async function archiveCriterion(item: GradingCriterionRow): Promise<void> {
    try {
      await archiveCriterionMutation.mutateAsync({ id: item.id });
      toast.success("グレード条件を削除しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "削除できませんでした"));
    }
  }

  async function archiveCategory(item: ScoringCategoryRow): Promise<void> {
    try {
      await archiveCategoryMutation.mutateAsync({ id: item.id });
      toast.success("カテゴリを削除しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "削除できませんでした"));
    }
  }

  function openCriterionCreate(): void {
    setCriterionSessionId((current) => current + 1);
    resourceEditor.openCreate();
  }

  function openCriterionEdit(item: GradingCriterionRow): void {
    setCriterionSessionId((current) => current + 1);
    resourceEditor.openEdit(item);
  }

  function onCategoryOpenChange(open: boolean): void {
    if (open && !categoryOpen) setCategorySessionId((current) => current + 1);
    setCategoryOpen(open);
  }

  return {
    criteria,
    categories,
    summary: summarizeGradingCriteria(criteria),
    criterionEditor: {
      ...resourceEditor,
      sessionId: criterionSessionId,
      openCreate: openCriterionCreate,
      openEdit: openCriterionEdit,
    },
    categoryEditor: {
      dialogOpen: categoryOpen,
      onOpenChange: onCategoryOpenChange,
      sessionId: categorySessionId,
    },
    archiveCriterion,
    archiveCategory,
  };
}
