import { CircleAlert, Info, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AutomationDefinition,
  AutomationGenerationResult,
  AutomationResourceResolution,
} from "@openengage/core/automations";
import type { ProjectBriefReference } from "@openengage/core/projects";

import { useGenerateAutomation } from "./automation-api";
import { nodeLabel, nodeTypeLabel } from "./automation-labels";

const OMIT_VALUE = "__omit__";

export type AutomationAiSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "refine";
  currentDefinition?: AutomationDefinition;
  entityId?: string;
  onApply: (definition: AutomationDefinition) => Promise<void>;
} & ProjectBriefReference;

export function AutomationAiSheet({
  open,
  onOpenChange,
  mode,
  currentDefinition,
  entityId,
  onApply,
  ...briefReference
}: AutomationAiSheetProps): ReactNode {
  const generate = useGenerateAutomation();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AutomationGenerationResult | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const workflow = useAiProposalWorkflow({
    open,
    workflowKey: createAiProposalWorkflowKey({
      resource: "automation",
      mode,
      entityId,
      projectId: briefReference.projectId,
      briefRevision: briefReference.briefRevision,
    }),
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
      workflow.acceptResponse(token, () => {
        setResult(next);
        setSelections({});
      });
    } catch (cause) {
      if (workflow.isCurrentResponse(token)) {
        setError(getErrorMessage(cause, "AIによる提案を生成できませんでした"));
      }
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "AIでフローを作成" : "AIでフローを編集"}</SheetTitle>
          <SheetDescription>
            目的や条件を入力すると、確認可能な下書きを作成します。保存・公開は自動では行いません。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field data-disabled={generate.isPending || applying} data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={`${mode}-automation-prompt`}>実現したいこと</FieldLabel>
              <Textarea
                id={`${mode}-automation-prompt`}
                value={prompt}
                disabled={generate.isPending || applying}
                aria-invalid={Boolean(error)}
                maxLength={4_000}
                rows={6}
                placeholder={
                  mode === "create"
                    ? "例: 新規登録後にウェルカムメールを送り、3日後に未開封ならフォローアップしたい"
                    : "例: 最初のメール後に2日待ち、クリックした人だけスコアを10追加したい"
                }
                onChange={(event) => setPrompt(event.target.value)}
              />
              <FieldDescription>{prompt.length.toLocaleString()} / 4,000文字</FieldDescription>
            </Field>
          </FieldGroup>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>生成できませんでした</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result?.status === "needs_input" ? (
            <ResourceResolutionForm
              result={result}
              selections={selections}
              onSelectionChange={(requestId, value) =>
                setSelections((current) => ({ ...current, [requestId]: value }))
              }
            />
          ) : null}

          {result?.status === "ready" ? (
            <ReadyProposal result={result} currentDefinition={currentDefinition} />
          ) : null}
        </div>

        <Separator />
        <SheetFooter>
          {result ? (
            <Button variant="ghost" disabled={generate.isPending || applying} onClick={restart}>
              <RotateCcw data-icon="inline-start" />
              最初からやり直す
            </Button>
          ) : null}
          {result?.status === "ready" ? (
            <LoadingButton
              busy={applying}
              busyLabel="適用中…"
              disabled={!workflow.canApply}
              onClick={() => void applyProposal()}
            >
              <Sparkles data-icon="inline-start" />
              {mode === "create" ? "この内容で下書きを作成" : "キャンバスに適用"}
            </LoadingButton>
          ) : (
            <LoadingButton
              busy={generate.isPending}
              busyLabel="提案を生成中…"
              disabled={!prompt.trim() || !resourceReady}
              onClick={() => void submitGeneration()}
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

function ResourceResolutionForm({
  result,
  selections,
  onSelectionChange,
}: {
  result: Extract<AutomationGenerationResult, { status: "needs_input" }>;
  selections: Record<string, string>;
  onSelectionChange: (requestId: string, value: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Info />
        <AlertTitle>追加の選択が必要です</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      <ItemGroup>
        {result.plannedSteps.map((step, index) => (
          <Item key={`${index}-${step}`} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle>ステップ {index + 1}</ItemTitle>
              <ItemDescription>{step}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <FieldGroup>
        {result.resources.map((request) => {
          const items = [
            ...request.options.map((option) => ({ label: option.name, value: option.id })),
            ...(request.canOmit ? [{ label: "このステップを省略", value: OMIT_VALUE }] : []),
          ];
          return (
            <Field key={request.requestId} data-invalid={items.length === 0}>
              <FieldLabel>{request.label}</FieldLabel>
              <Select
                items={items}
                value={selections[request.requestId] || null}
                onValueChange={(value) => onSelectionChange(request.requestId, value ?? "")}
              >
                <SelectTrigger className="w-full" aria-invalid={items.length === 0}>
                  <SelectValue placeholder="候補を選択してください" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} side="bottom">
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{request.reason}</FieldDescription>
              {items.length === 0 ? (
                <FieldError>
                  利用できる候補がありません。先に対象リソースを作成してください。
                </FieldError>
              ) : null}
            </Field>
          );
        })}
      </FieldGroup>
    </div>
  );
}

function ReadyProposal({
  result,
  currentDefinition,
}: {
  result: Extract<AutomationGenerationResult, { status: "ready" }>;
  currentDefinition: AutomationDefinition | undefined;
}): ReactNode {
  const diff = useMemo(
    () => (currentDefinition ? definitionDiff(currentDefinition, result.definition) : null),
    [currentDefinition, result.definition],
  );
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>{result.definition.name}</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      {diff ? (
        <div className="flex flex-wrap gap-2" aria-label="変更内容">
          <Badge variant="secondary">追加 {diff.added}</Badge>
          <Badge variant="secondary">変更 {diff.changed}</Badge>
          <Badge variant="secondary">削除 {diff.removed}</Badge>
        </div>
      ) : null}
      <ItemGroup>
        {result.definition.nodes.map((node, index) => (
          <Item key={node.id} variant="outline" size="sm">
            <Badge variant="secondary">{index + 1}</Badge>
            <ItemContent>
              <ItemTitle>{nodeLabel(node)}</ItemTitle>
              <ItemDescription>{nodeTypeLabel(node.type)}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
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
  );
}

function buildResolutions(
  result: Extract<AutomationGenerationResult, { status: "needs_input" }>,
  selections: Record<string, string>,
): AutomationResourceResolution[] {
  const resolutions: AutomationResourceResolution[] = [];
  for (const request of result.resources) {
    const value = selections[request.requestId];
    if (!value) continue;
    resolutions.push(
      value === OMIT_VALUE
        ? { requestId: request.requestId, decision: "omit" }
        : { requestId: request.requestId, decision: "select", resourceId: value },
    );
  }
  return resolutions;
}

function requireCurrentDefinition(
  definition: AutomationDefinition | undefined,
): AutomationDefinition {
  if (!definition) throw new Error("編集対象のオートメーションがありません");
  return definition;
}

export function definitionDiff(
  before: AutomationDefinition,
  after: AutomationDefinition,
): { added: number; changed: number; removed: number } {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterIds = new Set(after.nodes.map((node) => node.id));
  let added = 0;
  let changed = 0;
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous) added += 1;
    else if (
      JSON.stringify(previous) !== JSON.stringify(node) ||
      outgoingSignature(before, node.id) !== outgoingSignature(after, node.id)
    ) {
      changed += 1;
    }
  }
  return {
    added,
    changed,
    removed: before.nodes.filter((node) => !afterIds.has(node.id)).length,
  };
}

function outgoingSignature(definition: AutomationDefinition, nodeId: string): string {
  return definition.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => `${edge.branch}:${edge.target}`)
    .sort()
    .join("|");
}
