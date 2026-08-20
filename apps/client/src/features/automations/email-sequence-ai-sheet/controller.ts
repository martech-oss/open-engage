import { useState } from "react";

import { usePreviewEmailTemplate } from "@/features/emails/email-api";
import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  EmailSequenceGenerationResult,
  EmailSequenceProposal,
} from "@openengage/core/automations";

import { useApplyEmailSequence, useGenerateEmailSequence } from "../automation-api";
import { buildSequenceResolutions } from "./resolutions";
import type { EmailSequenceAiSheetProps } from "./types";

export function useEmailSequenceAiController({
  open,
  onOpenChange,
  onApplied,
  entityId,
  ...briefReference
}: EmailSequenceAiSheetProps) {
  const generate = useGenerateEmailSequence();
  const apply = useApplyEmailSequence();
  const preview = usePreviewEmailTemplate();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<EmailSequenceGenerationResult | null>(null);
  const [proposal, setProposal] = useState<EmailSequenceProposal | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedEmailRef, setSelectedEmailRef] = useState("");
  const [error, setError] = useState("");
  const workflow = useAiProposalWorkflow({
    open,
    requestKey: createAiProposalWorkflowKey([
      "email-sequence",
      "create",
      entityId ?? null,
      briefReference.projectId ?? null,
      briefReference.briefRevision ?? null,
    ]),
    onReset: clearState,
  });

  const requestsReady =
    result?.status !== "needs_input" ||
    result.requests.every((request) => Boolean(values[request.requestId]));

  async function submit(): Promise<void> {
    if (!prompt.trim()) return;
    const token = workflow.beginRequest();
    setError("");
    setPreviews({});
    try {
      const continuation = result?.status === "needs_input" ? result.continuation : undefined;
      const resolutions =
        result?.status === "needs_input" ? buildSequenceResolutions(result, values) : undefined;
      const next = await generate.mutateAsync(
        proposal
          ? {
              mode: "refine",
              prompt,
              currentProposal: proposal,
              continuation,
              resolutions,
              ...briefReference,
            }
          : {
              mode: "create",
              prompt,
              continuation,
              resolutions,
              ...briefReference,
            },
      );
      if (next.status !== "ready") {
        workflow.acceptProposal(token, () => {
          setResult(next);
          setValues({});
        });
        return;
      }
      const rendered = await Promise.all(
        next.proposal.emails.map(async (email) => {
          const output = await preview.mutateAsync({
            purpose: email.purpose,
            subject: email.selectedSubject,
            content: email.content,
          });
          return [email.emailRef, output.html] as const;
        }),
      );
      workflow.acceptProposal(token, () => {
        setResult(next);
        setValues({});
        setProposal(next.proposal);
        setSelectedEmailRef(next.proposal.emails[0]?.emailRef ?? "");
        setPreviews(Object.fromEntries(rendered));
      });
    } catch (cause) {
      workflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "AIによるメールシーケンスを生成できませんでした"));
      });
    }
  }

  async function applyProposal(): Promise<void> {
    if (!proposal || !workflow.canApply) return;
    setError("");
    try {
      const applied = await apply.mutateAsync({ ...proposal, ...briefReference });
      await onApplied(applied);
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "メールシーケンスの下書きを作成できませんでした"));
    }
  }

  function chooseSubject(emailRef: string, selectedSubject: string): void {
    setProposal((current) =>
      current
        ? {
            ...current,
            emails: current.emails.map((email) =>
              email.emailRef === emailRef ? { ...email, selectedSubject } : email,
            ),
          }
        : current,
    );
  }

  function clearState(): void {
    setPrompt("");
    setResult(null);
    setProposal(null);
    setValues({});
    setPreviews({});
    setSelectedEmailRef("");
    setError("");
  }

  return {
    prompt,
    setPrompt,
    result,
    proposal,
    values,
    setValues,
    previews,
    selectedEmailRef,
    setSelectedEmailRef,
    error,
    requestsReady,
    canApply: workflow.canApply,
    generatePending: generate.isPending,
    applyPending: apply.isPending,
    previewPending: preview.isPending,
    submit,
    applyProposal,
    chooseSubject,
    restart: workflow.reset,
  };
}

export type EmailSequenceAiController = ReturnType<typeof useEmailSequenceAiController>;
