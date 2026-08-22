import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/hooks/use-form-submission";
import { useResourceEditor } from "@/hooks/use-resource-editor";

import {
  scoringCategoriesQueryOptions,
  scoringRulesQueryOptions,
  type ScoringRuleRow,
  useArchiveScoringRule,
} from "./scoring-api";
import { summarizeScoringRules } from "./scoring-model";

export function useScoringRulesController() {
  const { data: rules } = useSuspenseQuery(scoringRulesQueryOptions());
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const resourceEditor = useResourceEditor<ScoringRuleRow>();
  const [sessionId, setSessionId] = useState(0);
  const archiveMutation = useArchiveScoringRule();

  async function archive(item: ScoringRuleRow): Promise<void> {
    try {
      await archiveMutation.mutateAsync({ id: item.id });
      toast.success("ルールをアーカイブしました");
    } catch (error) {
      toast.error(getErrorMessage(error, "アーカイブできませんでした"));
    }
  }

  function openCreate(): void {
    setSessionId((current) => current + 1);
    resourceEditor.openCreate();
  }

  function openEdit(item: ScoringRuleRow): void {
    setSessionId((current) => current + 1);
    resourceEditor.openEdit(item);
  }

  return {
    rules,
    categories,
    summary: summarizeScoringRules(rules, categories.length),
    editor: { ...resourceEditor, sessionId, openCreate, openEdit },
    archive,
  };
}
