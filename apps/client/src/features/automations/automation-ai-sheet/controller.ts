import { useState } from "react";

import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  AutomationDefinition,
  AutomationGenerationResult,
} from "@openengage/core/automations";

import { useGenerateAutomation } from "../automation-api";
import { buildResolutions } from "./resolutions";
import type { AutomationAiSheetProps } from "./types";

export function useAutomationAiController({
  open,
  onOpenChange: _onOpenChange,
  mode,
  currentDefinition,
  entityId,
  onApply,
  ...briefReference
}: AutomationAiSheetProps) {
  const generate = useGenerateAutomation();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AutomationGenerationResult | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const workflow = useAiProposalWorkflow({
    open,
    requestKey: createAiProposalWorkflowKey([
      "automation",
      mode,
      entityId ?? null,
      briefReference.projectId ?? null,
      briefReference.briefRevision ?? null,
    ]),
    onReset: clearState,
  });
  const resourceReady =
    result?.status !== "needs_input" ||
    result.resources.every((request) => Boolean(selections[request.requestId]));

  async function submitGeneration(): Promise<void> {
    if (!prompt.trim()) return;
    const token = workflow.beginRequest();
    setError("");
    try {
      const continuation = result?.status === "needs_input" ? result.continuation : undefined;
      const resolutions =
        result?.status === "needs_input" ? buildResolutions(result, selections) : undefined;
      const next = await generate.mutateAsync(
        mode === "create"
          ? {
              mode,
              prompt,
              continuation,
              resolutions,
              ...briefReference,
            }
          : {
              mode,
              prompt,
              currentDefinition: requireCurrentDefinition(currentDefinition),
              continuation,
              resolutions,
              ...briefReference,
            },
      );
      workflow.acceptProposal(token, () => {
        setResult(next);
        setSelections({});
      });
    } catch (cause) {
      workflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "AIによる提案を生成できませんでした"));
      });
    }
  }

  async function applyProposal(): Promise<void> {
    if (result?.status !== "ready" || !workflow.canApply) return;
    setApplying(true);
    setError("");
    try {
      await onApply(result.definition);
    } catch (cause) {
      setError(getErrorMessage(cause, "提案を適用できませんでした"));
    } finally {
      setApplying(false);
    }
  }

  function clearState(): void {
    setPrompt("");
    setResult(null);
    setSelections({});
    setError("");
    setApplying(false);
  }

  function restart(): void {
    workflow.reset();
  }

  return {
    prompt,
    setPrompt,
    result,
    selections,
    error,
    applying,
    resourceReady,
    generatePending: generate.isPending,
    canApply: workflow.canApply,
    submitGeneration,
    applyProposal,
    restart,
    selectResource: (requestId: string, value: string) =>
      setSelections((current) => ({ ...current, [requestId]: value })),
  };
}

function requireCurrentDefinition(
  definition: AutomationDefinition | undefined,
): AutomationDefinition {
  if (!definition) throw new Error("編集対象のオートメーションがありません");
  return definition;
}
