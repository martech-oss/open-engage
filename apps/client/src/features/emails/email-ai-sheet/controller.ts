import { useState } from "react";

import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  EmailGenerationResult,
  EmailImageRequest,
  GeneratedEmailImage,
} from "@openengage/core/messaging";

import {
  useGenerateEmailImage,
  useGenerateEmailTemplate,
  usePreviewEmailTemplate,
} from "../email-api";
import { insertGeneratedImage } from "./image-document";
import type { EmailAiSheetProps } from "./types";

export function useEmailAiController({
  open,
  onOpenChange,
  entityId,
  mode,
  purpose,
  current,
  onApply,
}: EmailAiSheetProps) {
  const generate = useGenerateEmailTemplate();
  const generateImage = useGenerateEmailImage();
  const previewMutation = usePreviewEmailTemplate();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<EmailGenerationResult | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  const [imageRequest, setImageRequest] = useState<EmailImageRequest | null>(null);
  const [generatedImage, setGeneratedImage] = useState<GeneratedEmailImage | null>(null);
  const [error, setError] = useState("");
  const requestKey = createAiProposalWorkflowKey([
    "email-template",
    entityId ?? "new",
    mode,
    purpose,
  ]);
  const workflow = useAiProposalWorkflow({ open, requestKey, onReset: clearState });
  const imageWorkflow = useAiProposalWorkflow({
    open,
    requestKey: createAiProposalWorkflowKey([requestKey, "image"]),
    onReset: clearImageState,
  });

  async function submitGeneration(): Promise<void> {
    if (!prompt.trim()) return;
    const token = workflow.beginRequest();
    setError("");
    imageWorkflow.reset();
    try {
      const next = await generate.mutateAsync(
        mode === "create" ? { mode, purpose, prompt } : { mode, purpose, prompt, current },
      );
      if (
        !workflow.acceptProposal(token, () => {
          setResult(next);
          setPreview(null);
          setImageRequest(next.imageRequests[0] ?? null);
        })
      ) {
        return;
      }
      const rendered = await previewMutation.mutateAsync({
        purpose,
        subject: next.proposal.subject,
        content: next.proposal.content,
      });
      workflow.acceptCurrent(token, () => setPreview(rendered));
    } catch (cause) {
      workflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "AIによるメール提案を生成できませんでした"));
      });
    }
  }

  async function createImage(): Promise<void> {
    if (!imageRequest) return;
    const token = imageWorkflow.beginRequest();
    setError("");
    try {
      const image = await generateImage.mutateAsync({
        requestId: imageRequest.requestId,
        prompt: imageRequest.prompt,
        alt: imageRequest.alt,
      });
      imageWorkflow.acceptCurrent(token, () => setGeneratedImage(image));
    } catch (cause) {
      imageWorkflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "画像を生成できませんでした"));
      });
    }
  }

  function applyProposal(): void {
    if (!result || !workflow.canApply) return;
    onApply({
      ...result.proposal,
      content:
        imageRequest && generatedImage
          ? insertGeneratedImage(result.proposal.content, imageRequest, generatedImage)
          : result.proposal.content,
    });
    onOpenChange(false);
  }

  function restart(): void {
    workflow.reset();
    imageWorkflow.reset();
  }

  function clearState(): void {
    setPrompt("");
    setResult(null);
    setPreview(null);
    setImageRequest(null);
    setGeneratedImage(null);
    setError("");
    generate.reset();
    previewMutation.reset();
    generateImage.reset();
  }

  function clearImageState(): void {
    setGeneratedImage(null);
    generateImage.reset();
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      workflow.reset();
      imageWorkflow.reset();
    }
    onOpenChange(nextOpen);
  }

  return {
    prompt,
    setPrompt,
    result,
    preview,
    imageRequest,
    setImageRequest,
    generatedImage,
    error,
    canApply: workflow.canApply,
    generatePending: generate.isPending,
    previewPending: previewMutation.isPending,
    imagePending: generateImage.isPending,
    submitGeneration,
    createImage,
    applyProposal,
    restart,
    handleOpenChange,
  };
}

export type EmailAiController = ReturnType<typeof useEmailAiController>;
