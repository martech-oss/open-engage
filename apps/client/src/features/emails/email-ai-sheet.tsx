import { CircleAlert, ImageIcon, Info, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  EmailDocumentV2,
  EmailGenerationProposal,
  EmailGenerationResult,
  EmailImageRequest,
  EmailPurpose,
  GeneratedEmailImage,
} from "@openengage/core/messaging";

import {
  useGenerateEmailImage,
  useGenerateEmailTemplate,
  usePreviewEmailTemplate,
} from "./email-api";

export function EmailAiSheet({
  open,
  onOpenChange,
  entityId,
  mode,
  purpose,
  current,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId?: string | undefined;
  mode: "create" | "refine";
  purpose: EmailPurpose;
  current: EmailGenerationProposal;
  onApply: (proposal: EmailGenerationProposal) => void;
}): ReactNode {
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

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "AIでメールを作成" : "AIでメールを改善"}</SheetTitle>
          <SheetDescription>
            React Email用の構造化された提案を作ります。下書きへの適用・保存・公開は別操作です。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {purpose === "transactional" ? "Transactional" : "Marketing"}
            </Badge>
            {purpose === "marketing" ? <Badge variant="outline">送信機能は未提供</Badge> : null}
          </div>

          <FieldGroup>
            <Field data-disabled={generate.isPending} data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="email-ai-prompt">作りたいメール</FieldLabel>
              <Textarea
                id="email-ai-prompt"
                value={prompt}
                disabled={generate.isPending}
                aria-invalid={Boolean(error)}
                maxLength={4_000}
                rows={6}
                placeholder={
                  mode === "create"
                    ? "例: 資料請求のお礼と、担当者から1営業日以内に連絡することを伝えたい"
                    : "例: 件名を短くし、最初の段落を親しみやすく、CTAを1つに絞って"
                }
                onChange={(event) => setPrompt(event.target.value)}
              />
              <FieldDescription>{prompt.length.toLocaleString()} / 4,000文字</FieldDescription>
            </Field>
          </FieldGroup>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>処理できませんでした</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <Sparkles />
                <AlertTitle>{result.proposal.name}</AlertTitle>
                <AlertDescription>{result.summary}</AlertDescription>
              </Alert>

              <ItemGroup>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>件名</ItemTitle>
                    <p className="text-sm text-muted-foreground">{result.proposal.subject}</p>
                  </ItemContent>
                </Item>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>構成</ItemTitle>
                    <p className="text-sm text-muted-foreground">
                      {result.proposal.content.blocks.length}ブロック
                    </p>
                  </ItemContent>
                </Item>
              </ItemGroup>

              {preview ? (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">{preview.subject}</p>
                  <iframe
                    title="AIメール提案プレビュー"
                    srcDoc={preview.html}
                    sandbox=""
                    className="h-96 w-full rounded-lg border"
                  />
                </div>
              ) : null}

              {imageRequest ? (
                <ImageRequestEditor
                  request={imageRequest}
                  image={generatedImage}
                  busy={generateImage.isPending}
                  onChange={setImageRequest}
                  onGenerate={() => void createImage()}
                />
              ) : null}

              {result.assumptions.length > 0 ? (
                <Alert>
                  <Info />
                  <AlertTitle>AIが置いた前提</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {result.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              {result.warnings.length > 0 ? (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>確認事項</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>

        <Separator />
        <SheetFooter>
          {result ? (
            <Button variant="ghost" disabled={generate.isPending} onClick={restart}>
              <RotateCcw data-icon="inline-start" />
              最初からやり直す
            </Button>
          ) : null}
          {result ? (
            <Button disabled={!workflow.canApply} onClick={applyProposal}>
              <Sparkles data-icon="inline-start" />
              この提案を下書きに適用
            </Button>
          ) : (
            <LoadingButton
              busy={generate.isPending || previewMutation.isPending}
              busyLabel="提案を生成中…"
              disabled={!prompt.trim()}
              onClick={() => void submitGeneration()}
            >
              <Sparkles data-icon="inline-start" />
              提案を生成
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ImageRequestEditor({
  request,
  image,
  busy,
  onChange,
  onGenerate,
}: {
  request: EmailImageRequest;
  image: GeneratedEmailImage | null;
  busy: boolean;
  onChange: (request: EmailImageRequest) => void;
  onGenerate: () => void;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>画像の提案</CardTitle>
        <CardDescription>内容を確認してから画像生成を実行します。最大1枚です。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email-image-prompt">画像プロンプト</FieldLabel>
            <Textarea
              id="email-image-prompt"
              value={request.prompt}
              maxLength={2_000}
              rows={4}
              onChange={(event) => onChange({ ...request, prompt: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-image-alt">代替テキスト</FieldLabel>
            <Textarea
              id="email-image-alt"
              value={request.alt}
              maxLength={500}
              rows={2}
              onChange={(event) => onChange({ ...request, alt: event.target.value })}
            />
          </Field>
        </FieldGroup>
        {image ? (
          <img
            src={image.previewUrl}
            alt={image.alt}
            className="max-h-72 rounded-lg border object-contain"
          />
        ) : null}
        <LoadingButton
          type="button"
          variant="outline"
          busy={busy}
          busyLabel="画像を生成中…"
          disabled={!request.prompt.trim() || !request.alt.trim()}
          onClick={onGenerate}
        >
          <ImageIcon data-icon="inline-start" />
          {image ? "画像を再生成" : "画像を生成"}
        </LoadingButton>
      </CardContent>
    </Card>
  );
}

export function insertGeneratedImage(
  document: EmailDocumentV2,
  request: EmailImageRequest,
  image: GeneratedEmailImage,
): EmailDocumentV2 {
  const block = {
    id: `generated-${image.assetId}`,
    type: "image" as const,
    source: { kind: "asset" as const, assetId: image.assetId },
    alt: image.alt,
    width: Math.min(document.theme.width - 48, 672),
    align: "center" as const,
  };
  if (request.afterBlockId === null) return { ...document, blocks: [block, ...document.blocks] };
  const index = document.blocks.findIndex((current) => current.id === request.afterBlockId);
  if (index < 0) return { ...document, blocks: [...document.blocks, block] };
  return {
    ...document,
    blocks: [...document.blocks.slice(0, index + 1), block, ...document.blocks.slice(index + 1)],
  };
}
