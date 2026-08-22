import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppDialog, ErrorAlert, LoadingButton, PageLayout, SimpleEmpty } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";

import {
  projectBriefOptionsQueryOptions,
  projectBriefsQueryOptions,
  useCreateProjectBrief,
  useGenerateProjectBrief,
} from "./project-brief-api";
import { BriefStatus } from "./project-brief-detail-components";
import {
  emptyBrief,
  formDraftFromInput,
  mergeAiProposalPreservingEdits,
  ProjectBriefForm,
  type ProjectBriefFieldErrors,
  useProjectBriefDraft,
  validateProjectBriefDraft,
} from "./project-brief-form";
import {
  isReviewOverdue,
  matchesProjectBriefSearch,
  type ProjectBriefSearch,
} from "./project-brief-list-filters";

export function ProjectBriefsPage({ search }: { search: ProjectBriefSearch }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const { renderedAt } = useWorkspaceTime();
  const now = new Date(renderedAt).getTime();
  const { data: briefs } = useSuspenseQuery(projectBriefsQueryOptions());
  const { data: options } = useSuspenseQuery(projectBriefOptionsQueryOptions());
  const navigate = useNavigate();
  const create = useCreateProjectBrief();
  const generate = useGenerateProjectBrief();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const { draft, setDraft, resetDraft } = useProjectBriefDraft(emptyBrief());
  const [fieldErrors, setFieldErrors] = useState<ProjectBriefFieldErrors>({});
  const [error, setError] = useState("");
  const [createSession, setCreateSession] = useState(0);
  const proposalWorkflow = useAiProposalWorkflow({
    open,
    requestKey: createAiProposalWorkflowKey(["project-brief", "create", createSession]),
    onReset: resetCreateState,
  });
  const filtered = useMemo(
    () => briefs.filter((brief) => matchesProjectBriefSearch(brief, search, now)),
    [briefs, now, search],
  );

  function setSearch(patch: Partial<ProjectBriefSearch>): void {
    void navigate({
      to: "/automations/briefs",
      search: { ...search, ...patch },
      replace: true,
    });
  }

  async function generateProposal(): Promise<void> {
    if (!prompt.trim()) return;
    const token = proposalWorkflow.beginRequest();
    const before = draft;
    setError("");
    try {
      const result = await generate.mutateAsync({ mode: "create", prompt });
      const proposed = formDraftFromInput({
        ...result.proposal,
        ownerUserId: before.ownerUserId || options.members[0]?.id || "",
        approverUserId: before.approverUserId || options.members[1]?.id || "",
      });
      proposalWorkflow.acceptProposal(token, () => {
        setDraft((current) => mergeAiProposalPreservingEdits(current, before, proposed));
        if (result.capabilityGaps.length) {
          toast.warning(`${result.capabilityGaps.length}件の未提供機能があります`);
        }
      });
    } catch (cause) {
      proposalWorkflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "AI提案を生成できませんでした"));
      });
    }
  }

  function resetCreateState(): void {
    setPrompt("");
    resetDraft(emptyBrief());
    setFieldErrors({});
    setError("");
  }

  async function save(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    setError("");
    const validation = validateProjectBriefDraft(draft);
    if (!validation.success) {
      setFieldErrors(validation.errors);
      setError("入力内容を確認してください");
      return;
    }
    setFieldErrors({});
    try {
      const result = await create.mutateAsync(validation.data);
      setOpen(false);
      await navigate({ to: "/automations/briefs/$id", params: { id: result.id } });
    } catch (cause) {
      setError(getErrorMessage(cause, "施策ブリーフを作成できませんでした"));
    }
  }

  return (
    <PageLayout
      title="施策ブリーフ"
      action={
        <Button
          onClick={() => {
            setCreateSession((session) => session + 1);
            resetCreateState();
            setOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          施策を作成
        </Button>
      }
    >
      <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
        <FilterSelect
          label="状態"
          value={search.status}
          onChange={(status) => setSearch({ status: status as ProjectBriefSearch["status"] })}
          options={[
            ["all", "すべて"],
            ["draft", "下書き"],
            ["pending_approval", "承認待ち"],
            ["approved", "承認済み"],
            ["completed", "終了"],
          ]}
        />
        <FilterSelect
          label="モーション"
          value={search.motion}
          onChange={(motion) => setSearch({ motion: motion as ProjectBriefSearch["motion"] })}
          options={[
            ["all", "すべて"],
            ["acquisition", "獲得"],
            ["onboarding", "オンボーディング"],
            ["engagement", "エンゲージメント"],
            ["retention", "継続"],
            ["reactivation", "再活性化"],
            ["measurement", "計測"],
          ]}
        />
        <FilterSelect
          label="担当者"
          value={search.owner}
          onChange={(owner) => setSearch({ owner })}
          options={[
            ["all", "すべて"],
            ...options.members.map((member) => [member.id, member.name] as [string, string]),
          ]}
        />
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={search.overdue}
            onChange={(event) => setSearch({ overdue: event.target.checked })}
          />
          レビュー期限超過のみ
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((brief) => (
          <Card key={brief.id}>
            <CardHeader>
              <CardTitle>{brief.name}</CardTitle>
              <BriefStatus status={brief.status} />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{brief.description || brief.primaryMotion}</p>
              <p className="text-muted-foreground">
                担当 {brief.ownerName} · 承認 {brief.approverName}
              </p>
              <p
                className={
                  isReviewOverdue(brief, now) ? "text-destructive" : "text-muted-foreground"
                }
              >
                レビュー {formatDateTime(brief.reviewAt)}
              </p>
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-xs text-muted-foreground">
                関連 {brief.itemCount}件 · rev.{brief.revision}
              </span>
              <Button
                size="sm"
                variant="outline"
                render={<Link to="/automations/briefs/$id" params={{ id: brief.id }} />}
              >
                詳細
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {filtered.length === 0 ? (
        <SimpleEmpty label="条件に一致する施策ブリーフはありません" />
      ) : null}
      <AppDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            resetCreateState();
          }
        }}
        title="施策ブリーフを作成"
        description="AI提案から始めるか、各項目を直接入力します。"
        className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
      >
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <Field>
            <FieldLabel htmlFor="brief-prompt">AIへの依頼</FieldLabel>
            <Textarea
              id="brief-prompt"
              rows={4}
              value={prompt}
              maxLength={4_000}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <LoadingButton
              busy={generate.isPending}
              disabled={!prompt.trim()}
              variant="outline"
              type="button"
              onClick={() => void generateProposal()}
            >
              <Sparkles data-icon="inline-start" />
              提案を生成
            </LoadingButton>
          </Field>
          <ProjectBriefForm
            value={draft}
            members={options.members}
            errors={fieldErrors}
            onChange={setDraft}
          />
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <LoadingButton className="w-full" type="submit" busy={create.isPending}>
            下書きを作成
          </LoadingButton>
        </form>
      </AppDialog>
    </PageLayout>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => (
          <NativeSelectOption key={id} value={id}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
