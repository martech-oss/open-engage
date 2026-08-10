import { CircleAlert, Info, RotateCcw, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  SegmentDefinition,
  SegmentGenerationResult,
  SegmentResourceResolution,
} from "@openengage/core/segments";

import { useGenerateSegment } from "./segment-api";

export function SegmentAiSheet({
  open,
  onOpenChange,
  mode,
  currentDefinition,
  projectId,
  briefRevision,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "refine";
  currentDefinition?: SegmentDefinition;
  projectId?: string;
  briefRevision?: number;
  onApply: (definition: SegmentDefinition) => Promise<void>;
}): ReactNode {
  const generate = useGenerateSegment();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<SegmentGenerationResult | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const resourcesReady =
    result?.status !== "needs_input" ||
    result.resources.every((request) => Boolean(selections[request.requestId]));

  async function submit(): Promise<void> {
    if (!prompt.trim()) return;
    setError("");
    try {
      const continuation = result?.status === "needs_input" ? result.continuation : undefined;
      const resolutions: SegmentResourceResolution[] | undefined =
        result?.status === "needs_input"
          ? result.resources.map((request) => ({
              requestId: request.requestId,
              resourceId: selections[request.requestId] ?? "",
            }))
          : undefined;
      const next = await generate.mutateAsync(
        mode === "create"
          ? {
              mode,
              prompt,
              continuation,
              resolutions,
              ...(projectId && briefRevision ? { projectId, briefRevision } : {}),
            }
          : {
              mode,
              prompt,
              currentDefinition: requireDefinition(currentDefinition),
              continuation,
              resolutions,
              ...(projectId && briefRevision ? { projectId, briefRevision } : {}),
            },
      );
      setResult(next);
      setSelections({});
    } catch (cause) {
      setError(getErrorMessage(cause, "AIによるセグメント提案を生成できませんでした"));
    }
  }

  async function apply(): Promise<void> {
    if (result?.status !== "ready") return;
    setApplying(true);
    setError("");
    try {
      await onApply(result.definition);
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "提案を適用できませんでした"));
    } finally {
      setApplying(false);
    }
  }

  function restart(): void {
    setResult(null);
    setSelections({});
    setError("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "AIでセグメントを作成" : "AIで条件を編集"}</SheetTitle>
          <SheetDescription>
            対象者を説明すると、実在リソースと人数を確認した下書きを作成します。保存は自動では行いません。
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel>対象オーディエンス</FieldLabel>
              <Textarea
                value={prompt}
                maxLength={4_000}
                rows={6}
                placeholder="例: 有効なtrialユーザーで、score 50以上またはtrial_activated済み、製品情報を購読中、配信禁止タグなし"
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
          {result?.status === "needs_input" ? (
            <div className="space-y-4">
              <Alert>
                <Info />
                <AlertTitle>リソースの選択が必要です</AlertTitle>
                <AlertDescription>{result.summary}</AlertDescription>
              </Alert>
              {result.resources.map((request) => (
                <Field key={request.requestId}>
                  <FieldLabel>{request.label}</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    value={selections[request.requestId] ?? ""}
                    onChange={(event) =>
                      setSelections((current) => ({
                        ...current,
                        [request.requestId]: event.target.value,
                      }))
                    }
                  >
                    <NativeSelectOption value="">選択してください</NativeSelectOption>
                    {request.options.map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>{request.reason}</FieldDescription>
                </Field>
              ))}
            </div>
          ) : null}
          {result?.status === "ready" ? (
            <div className="space-y-4">
              <Alert>
                <Sparkles />
                <AlertTitle>{result.definition.name}</AlertTitle>
                <AlertDescription>{result.summary}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{result.definition.kind}</Badge>
                <Badge variant="secondary">
                  一致 {result.preview.matchedCount.toLocaleString()}件
                </Badge>
              </div>
              <ItemGroup>
                {[...result.inclusion, ...result.exclusion].map((condition, index) => (
                  <Item key={`${index}-${condition}`} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>条件 {index + 1}</ItemTitle>
                      <ItemDescription>{condition}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
              {result.deliveryGuardrails.length > 0 ? (
                <Alert>
                  <Info />
                  <AlertTitle>配信時のガードレール</AlertTitle>
                  <AlertDescription>{result.deliveryGuardrails.join(" / ")}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
        <Separator />
        <SheetFooter>
          {result ? (
            <Button variant="ghost" disabled={generate.isPending || applying} onClick={restart}>
              <RotateCcw data-icon="inline-start" />
              最初から
            </Button>
          ) : null}
          {result?.status === "ready" ? (
            <LoadingButton busy={applying} busyLabel="適用中…" onClick={() => void apply()}>
              <Sparkles data-icon="inline-start" />
              この内容で{mode === "create" ? "作成" : "更新"}
            </LoadingButton>
          ) : (
            <LoadingButton
              busy={generate.isPending}
              busyLabel="生成中…"
              disabled={!prompt.trim() || !resourcesReady}
              onClick={() => void submit()}
            >
              <Sparkles data-icon="inline-start" />
              {result?.status === "needs_input" ? "選択内容で再生成" : "提案を生成"}
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function requireDefinition(definition: SegmentDefinition | undefined): SegmentDefinition {
  if (!definition) throw new Error("Current segment definition is required");
  return definition;
}
