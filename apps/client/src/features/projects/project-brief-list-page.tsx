import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppDialog, ErrorAlert, LoadingButton, PageLayout, SimpleEmpty } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";
import type { ProjectBriefMutation, ProjectBriefStatus } from "@openengage/core/projects";

import {
  projectBriefOptionsQueryOptions,
  projectBriefsQueryOptions,
  useCreateProjectBrief,
  useGenerateProjectBrief,
} from "./project-brief-api";
import { emptyBrief, ProjectBriefForm } from "./project-brief-form";

export function ProjectBriefsPage(): ReactNode {
  const { data: briefs } = useSuspenseQuery(projectBriefsQueryOptions());
  const { data: options } = useSuspenseQuery(projectBriefOptionsQueryOptions());
  const navigate = useNavigate();
  const create = useCreateProjectBrief();
  const generate = useGenerateProjectBrief();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<ProjectBriefMutation>(emptyBrief());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [motion, setMotion] = useState("all");
  const [owner, setOwner] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const filtered = useMemo(
    () =>
      briefs.filter(
        (brief) =>
          (status === "all" || brief.status === status) &&
          (motion === "all" || brief.primaryMotion === motion) &&
          (owner === "all" || brief.ownerUserId === owner) &&
          (!overdueOnly ||
            (brief.status === "approved" && new Date(brief.reviewAt).getTime() < Date.now())),
      ),
    [briefs, motion, overdueOnly, owner, status],
  );

  async function generateProposal(): Promise<void> {
    if (!prompt.trim()) return;
    setError("");
    try {
      const result = await generate.mutateAsync({ mode: "create", prompt });
      setDraft({
        ...draft,
        ...result.proposal,
        ownerUserId: draft.ownerUserId || options.members[0]?.id || "",
        approverUserId: draft.approverUserId || options.members[1]?.id || "",
      });
      if (result.capabilityGaps.length) {
        toast.warning(`${result.capabilityGaps.length}件の未提供機能があります`);
      }
    } catch (cause) {
      setError(getErrorMessage(cause, "AI提案を生成できませんでした"));
    }
  }

  async function save(): Promise<void> {
    setError("");
    try {
      const result = await create.mutateAsync(draft);
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
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          施策を作成
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        対象者・トリガー・フロー・担当・KPIを承認可能な施策として管理します。
      </p>
      <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
        <FilterSelect
          label="状態"
          value={status}
          onChange={setStatus}
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
          value={motion}
          onChange={setMotion}
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
          value={owner}
          onChange={setOwner}
          options={[
            ["all", "すべて"],
            ...options.members.map((member) => [member.id, member.name] as [string, string]),
          ]}
        />
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => setOverdueOnly(event.target.checked)}
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
                  new Date(brief.reviewAt).getTime() < Date.now() && brief.status === "approved"
                    ? "text-destructive"
                    : "text-muted-foreground"
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
        onOpenChange={setOpen}
        title="施策ブリーフを作成"
        description="AI提案から始めるか、各項目を直接入力します。"
        className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
      >
        <div className="space-y-4">
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
              onClick={() => void generateProposal()}
            >
              <Sparkles data-icon="inline-start" />
              提案を生成
            </LoadingButton>
          </Field>
          <ProjectBriefForm value={draft} members={options.members} onChange={setDraft} />
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <LoadingButton className="w-full" busy={create.isPending} onClick={() => void save()}>
            下書きを作成
          </LoadingButton>
        </div>
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

function BriefStatus({ status }: { status: ProjectBriefStatus }): ReactNode {
  return (
    <Badge
      variant={
        status === "approved" ? "default" : status === "pending_approval" ? "secondary" : "outline"
      }
    >
      {
        (
          {
            draft: "下書き",
            pending_approval: "承認待ち",
            approved: "承認済み",
            completed: "終了",
          } as const
        )[status]
      }
    </Badge>
  );
}
