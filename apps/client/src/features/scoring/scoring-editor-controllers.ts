import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { contactOptionsQueryOptions } from "@/features/contacts/contact-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import type { GradingCriterionWrite, ScoringRuleWrite } from "@openengage/core/scoring";

import {
  type GradingCriterionRow,
  scoringCategoriesQueryOptions,
  type ScoringRuleRow,
  useCreateGradingCriterion,
  useCreateScoringCategory,
  useCreateScoringRule,
  useUpdateGradingCriterion,
  useUpdateScoringRule,
} from "./scoring-api";

export function useScoringRuleEditorController(item: ScoringRuleRow | null, onSaved: () => void) {
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const { data: contactOptions } = useSuspenseQuery(contactOptionsQueryOptions());
  const [matchType, setMatchType] = useState<ScoringRuleWrite["matchType"]>(
    item?.matchType ?? "any",
  );
  const submission = useFormSubmission("保存できませんでした");
  const create = useCreateScoringRule();
  const update = useUpdateScoringRule();

  const save = (payload: ScoringRuleWrite) =>
    submission.run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => create.mutateAsync(data),
        update: (id, data) => update.mutateAsync({ id, ...data }),
        createdMessage: "ルールを作成しました",
        updatedMessage: "ルールを更新しました",
        onSaved,
      }),
    );

  return { categories, contactOptions, matchType, setMatchType, save, ...submission };
}

export function useGradingCriterionEditorController(
  item: GradingCriterionRow | null,
  onSaved: () => void,
) {
  const [field, setField] = useState<GradingCriterionWrite["field"]>(item?.field ?? "custom_field");
  const submission = useFormSubmission("保存できませんでした");
  const create = useCreateGradingCriterion();
  const update = useUpdateGradingCriterion();

  const save = (payload: GradingCriterionWrite) =>
    submission.run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => create.mutateAsync(data),
        update: (id, data) => update.mutateAsync({ id, ...data }),
        createdMessage: "グレード条件を作成しました",
        updatedMessage: "グレード条件を更新しました",
        onSaved,
      }),
    );

  return { field, setField, save, ...submission };
}

export function useScoringCategoryEditorController(onSaved: () => void) {
  const submission = useFormSubmission("保存できませんでした");
  const create = useCreateScoringCategory();
  const save = (payload: { name: string; slug: string }) =>
    submission.run(async () => {
      await create.mutateAsync(payload);
      toast.success("カテゴリを作成しました");
      onSaved();
    });
  return { save, ...submission };
}
