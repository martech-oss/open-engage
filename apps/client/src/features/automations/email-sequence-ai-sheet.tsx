import { CircleAlert, Info, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { usePreviewEmailTemplate } from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  ApplyEmailSequenceResult,
  EmailSequenceGenerationResult,
  EmailSequenceProposal,
  EmailSequenceResolution,
} from "@openengage/core/automations";

import { useApplyEmailSequence, useGenerateEmailSequence } from "./automation-api";
import { nodeLabel, nodeTypeLabel } from "./automation-labels";

const OMIT_VALUE = "__omit__";

export function EmailSequenceAiSheet({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (result: ApplyEmailSequenceResult) => Promise<void>;
}): ReactNode {
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

  const requestsReady =
    result?.status !== "needs_input" ||
    result.requests.every((request) => Boolean(values[request.requestId]));

  async function submit(): Promise<void> {
    if (!prompt.trim()) return;
    setError("");
    setPreviews({});
    try {
      const continuation = result?.status === "needs_input" ? result.continuation : undefined;
      const resolutions =
        result?.status === "needs_input" ? buildSequenceResolutions(result, values) : undefined;
      const next = await generate.mutateAsync(
        proposal
          ? { mode: "refine", prompt, currentProposal: proposal, continuation, resolutions }
          : { mode: "create", prompt, continuation, resolutions },
      );
      setResult(next);
      setValues({});
      if (next.status !== "ready") return;
      setProposal(next.proposal);
      setSelectedEmailRef(next.proposal.emails[0]?.emailRef ?? "");
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
      setPreviews(Object.fromEntries(rendered));
    } catch (cause) {
      setError(getErrorMessage(cause, "AIによるメールシーケンスを生成できませんでした"));
    }
  }

  async function applyProposal(): Promise<void> {
    if (!proposal) return;
    setError("");
    try {
      const applied = await apply.mutateAsync(proposal);
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

  function restart(): void {
    setResult(null);
    setProposal(null);
    setValues({});
    setPreviews({});
    setSelectedEmailRef("");
    setError("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>AIでメールシーケンスを作成</SheetTitle>
          <SheetDescription>
            2〜8通のメール、間隔、分岐、終了条件を設計します。確認後も下書きのみ作成し、公開や送信は行いません。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field data-disabled={generate.isPending || apply.isPending}>
              <FieldLabel htmlFor="email-sequence-prompt">実現したいライフサイクル施策</FieldLabel>
              <Textarea
                id="email-sequence-prompt"
                value={prompt}
                maxLength={4_000}
                rows={6}
                disabled={generate.isPending || apply.isPending}
                placeholder="例: トライアル登録者に14日間でオンボーディングメールを送り、最初のキャンペーン公開を促したい。公開済みなら以降は終了する。"
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
            <NeedsInput result={result} values={values} onChange={setValues} />
          ) : null}
          {proposal && result?.status !== "needs_input" ? (
            <ReadySequence
              proposal={proposal}
              previews={previews}
              selectedEmailRef={selectedEmailRef}
              onSelectEmail={setSelectedEmailRef}
              onChooseSubject={chooseSubject}
            />
          ) : null}
        </div>

        <Separator />
        <SheetFooter>
          {result || proposal ? (
            <Button
              variant="ghost"
              disabled={generate.isPending || apply.isPending}
              onClick={restart}
            >
              <RotateCcw data-icon="inline-start" />
              最初からやり直す
            </Button>
          ) : null}
          {proposal && result?.status !== "needs_input" ? (
            <>
              <LoadingButton
                variant="outline"
                busy={generate.isPending || preview.isPending}
                busyLabel="提案を改善中…"
                disabled={!prompt.trim()}
                onClick={() => void submit()}
              >
                <Sparkles data-icon="inline-start" />
                追加指示で改善
              </LoadingButton>
              <LoadingButton
                busy={apply.isPending}
                busyLabel="下書きを作成中…"
                disabled={
                  generate.isPending || Object.keys(previews).length !== proposal.emails.length
                }
                onClick={() => void applyProposal()}
              >
                <Sparkles data-icon="inline-start" />
                テンプレートとフローの下書きを作成
              </LoadingButton>
            </>
          ) : (
            <LoadingButton
              busy={generate.isPending || preview.isPending}
              busyLabel="提案を生成中…"
              disabled={!prompt.trim() || !requestsReady}
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

function NeedsInput({
  result,
  values,
  onChange,
}: {
  result: Extract<EmailSequenceGenerationResult, { status: "needs_input" }>;
  values: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Info />
        <AlertTitle>追加情報が必要です</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {result.plannedSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <FieldGroup>
        {result.requests.map((request) => (
          <Field key={request.requestId}>
            <FieldLabel>{request.label}</FieldLabel>
            {request.inputType === "resource" ? (
              <NativeSelect
                value={values[request.requestId] ?? ""}
                onChange={(event) =>
                  onChange({ ...values, [request.requestId]: event.target.value })
                }
              >
                <NativeSelectOption value="">選択してください</NativeSelectOption>
                {request.options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
                {!request.required ? (
                  <NativeSelectOption value={OMIT_VALUE}>この要件を省略</NativeSelectOption>
                ) : null}
              </NativeSelect>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={
                    values[request.requestId] === OMIT_VALUE
                      ? ""
                      : (values[request.requestId] ?? "")
                  }
                  disabled={values[request.requestId] === OMIT_VALUE}
                  maxLength={2_000}
                  placeholder={
                    request.kind === "cta_url" ? "https://example.com/..." : "入力してください"
                  }
                  onChange={(event) =>
                    onChange({ ...values, [request.requestId]: event.target.value })
                  }
                />
                {!request.required ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({
                        ...values,
                        [request.requestId]:
                          values[request.requestId] === OMIT_VALUE ? "" : OMIT_VALUE,
                      })
                    }
                  >
                    {values[request.requestId] === OMIT_VALUE ? "入力に戻す" : "省略"}
                  </Button>
                ) : null}
              </div>
            )}
            <FieldDescription>{request.reason}</FieldDescription>
          </Field>
        ))}
      </FieldGroup>
    </div>
  );
}

function ReadySequence({
  proposal,
  previews,
  selectedEmailRef,
  onSelectEmail,
  onChooseSubject,
}: {
  proposal: EmailSequenceProposal;
  previews: Record<string, string>;
  selectedEmailRef: string;
  onSelectEmail: (emailRef: string) => void;
  onChooseSubject: (emailRef: string, subject: string) => void;
}): ReactNode {
  const selected = proposal.emails.find((email) => email.emailRef === selectedEmailRef);
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>{proposal.overview.name}</AlertTitle>
        <AlertDescription>{proposal.summary}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{proposal.overview.type.replaceAll("_", " ")}</Badge>
        <Badge
          variant={
            proposal.capabilityState === "transactional-compatible" ? "secondary" : "outline"
          }
        >
          {proposal.capabilityState === "transactional-compatible"
            ? "Transactional互換"
            : "Marketing送信は未提供"}
        </Badge>
        <Badge variant="outline">{proposal.emails.length}通</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">シーケンス設計</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="対象" value={proposal.overview.audience} />
          <Summary label="開始" value={proposal.overview.entry} />
          <Summary label="目的" value={proposal.overview.outcome} />
          <Summary label="終了" value={proposal.overview.conversionExit} />
          <Summary label="間隔" value={proposal.overview.cadence} />
          <Summary label="再参加" value={proposal.overview.reentry} />
        </CardContent>
      </Card>

      <Field>
        <FieldLabel>確認するメール</FieldLabel>
        <NativeSelect
          value={selectedEmailRef}
          onChange={(event) => onSelectEmail(event.target.value)}
        >
          {proposal.emails.map((email, index) => (
            <NativeSelectOption key={email.emailRef} value={email.emailRef}>
              {index + 1}. {email.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selected.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel>件名</FieldLabel>
              <NativeSelect
                value={selected.selectedSubject}
                onChange={(event) => onChooseSubject(selected.emailRef, event.target.value)}
              >
                {selected.subjectOptions.map((subject) => (
                  <NativeSelectOption key={subject} value={subject}>
                    {subject}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Summary label="プレビューテキスト" value={selected.content.previewText} />
            <Summary label="送信タイミング" value={selected.timing} />
            {previews[selected.emailRef] ? (
              <iframe
                title={`${selected.name}のプレビュー`}
                srcDoc={previews[selected.emailRef]}
                sandbox=""
                className="h-96 w-full rounded-lg border"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automationフロー</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {proposal.definition.nodes.map((node, index) => (
              <li key={node.id} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{index + 1}</Badge>
                <span>{nodeLabel(node)}</span>
                <span className="text-muted-foreground">{nodeTypeLabel(node.type)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">計測</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="主要成果" value={proposal.measurement.primaryOutcome} />
          <Summary label="早期シグナル" value={proposal.measurement.earlySignal} />
          <Summary label="ベースライン" value={proposal.measurement.baseline} />
          <Summary label="目標" value={proposal.measurement.target} />
        </CardContent>
      </Card>
      {proposal.assumptions.length > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>AIが置いた前提</AlertTitle>
          <AlertDescription>{proposal.assumptions.join(" / ")}</AlertDescription>
        </Alert>
      ) : null}
      {proposal.warnings.length > 0 ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>確認事項</AlertTitle>
          <AlertDescription>{proposal.warnings.join(" / ")}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 leading-5">{value}</div>
    </div>
  );
}

export function buildSequenceResolutions(
  result: Extract<EmailSequenceGenerationResult, { status: "needs_input" }>,
  values: Record<string, string>,
): EmailSequenceResolution[] {
  const resolutions: EmailSequenceResolution[] = [];
  for (const request of result.requests) {
    const value = values[request.requestId];
    if (!value) continue;
    if (value === OMIT_VALUE) {
      resolutions.push({ requestId: request.requestId, decision: "omit" });
    } else if (request.inputType === "resource") {
      resolutions.push({ requestId: request.requestId, decision: "select", resourceId: value });
    } else {
      resolutions.push({ requestId: request.requestId, decision: "provide", value });
    }
  }
  return resolutions;
}
