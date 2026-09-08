import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useResourceEditor } from "@/hooks/use-resource-editor";

import {
  scoringCategoriesQueryOptions,
  scoringRulesQueryOptions,
  type ScoringRuleRow,
  useArchiveScoringRule,
} from "./scoring-api";

export function useScoringRulesController() {
  const pagination = useCursorPagination("scoring-rules");
  const { data: page } = useSuspenseQuery(
    scoringRulesQueryOptions(pagination.cursor ? { cursor: pagination.cursor } : {}),
  );
  const rules = page.items;
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
    pagination: {
      hasNextPage: Boolean(page.nextCursor),
      hasPreviousPage: pagination.hasPreviousPage,
      onNext: () => pagination.goToNextPage(page.nextCursor),
      onPrevious: pagination.goToPreviousPage,
      rangeLabel: `全 ${page.total} 件`,
    },
    categories,
    summary: { total: page.total, ...page.summary, categories: categories.length },
    editor: { ...resourceEditor, sessionId, openCreate, openEdit },
    archive,
  };
}
