import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import type {
  ProjectCloneJob,
  ProjectCloneOptions,
  ProjectCloneResourceKind,
  VariableDefinition,
} from "@openengage/core/projects";

import {
  projectCloneListQueryOptions,
  projectCloneQueryOptions,
  usePreviewProjectClone,
  useRetryProjectClone,
  useStartProjectClone,
} from "./clone-api";
import { projectBriefOptionsQueryOptions } from "./project-brief-api";
import { variablesQueryOptions } from "./variable-api";

const kindLabels: Record<ProjectCloneResourceKind, string> = {
  project: "施策",
  brief: "ブリーフ",
  program: "参加者ステータス",
  variable: "変数",
  automation: "Automation",
  automation_version: "Automationの版",
  form: "フォーム",
  form_version: "フォームの版",
  form_binding: "フォームの参加先",
  landing_page: "LP",
  landing_page_version: "LPの版",
  experiment: "LP実験",
  dynamic_content: "動的コンテンツ",
  segment: "リスト・セグメント",
  redirect: "計測リンク",
  email_sequence: "Transactionalテンプレート",
};
const statusLabels = {
  preview: "確認待ち",
  queued: "開始待ち",
  running: "複製中",
  completed: "完了",
  failed: "失敗",
} as const;

export function ProjectClonePanel({
  projectId,
  projectName,
  canEdit = true,
}: {
  projectId: string;
  projectName: string;
  canEdit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    ...projectCloneListQueryOptions(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((job) => ["queued", "running"].includes(job.status)) ? 3000 : false,
  });
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="施策の複製">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">施策の複製</h2>
          <p className="text-sm text-muted-foreground">
            設定と関連リソースを、新しい施策の下書きとして作成します。
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Copy />
            複製
          </Button>
        )}
      </div>
      {list.error && (
        <ErrorAlert>{getErrorMessage(list.error, "複製履歴を取得できませんでした")}</ErrorAlert>
      )}
      {list.data
        ?.filter((job) => job.status !== "preview")
        .map((job) => (
          <CloneJobProgress key={job.id} job={job} canEdit={canEdit} />
        ))}
      {open && (
        <ProjectCloneDialog
          projectId={projectId}
          projectName={projectName}
          onOpenChange={setOpen}
        />
      )}
    </section>
  );
}

function CloneJobProgress({ job, canEdit }: { job: ProjectCloneJob; canEdit: boolean }) {
  const retry = useRetryProjectClone();
  return (
    <div className="space-y-2 rounded-md border p-3" aria-label={`${job.options.name}の複製状況`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{job.options.name}</strong>
        <span>{statusLabels[job.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        準備済み {job.preparedCount} / {job.totalCount} 件
      </p>
      {["running", "queued"].includes(job.status) && (
        <progress
          className="w-full"
          max={job.totalCount || 1}
          value={job.preparedCount}
          aria-label="複製の進捗"
        />
      )}
      {job.error && <ErrorAlert>{job.error}</ErrorAlert>}
      {retry.error && (
        <ErrorAlert>{getErrorMessage(retry.error, "再試行できませんでした")}</ErrorAlert>
      )}
      {job.status === "failed" && canEdit && (
        <LoadingButton
          busy={retry.isPending}
          variant="outline"
          onClick={() => retry.mutate({ id: job.sourceProjectId, jobId: job.id })}
        >
          失敗した複製を再試行
        </LoadingButton>
      )}
      {job.status === "completed" && (
        <Button
          variant="outline"
          render={<Link to="/projects/$id" params={{ id: job.targetProjectId }} />}
        >
          複製先を開く
        </Button>
      )}
    </div>
  );
}

function ProjectCloneDialog({
  projectId,
  projectName,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: options } = useQuery(projectBriefOptionsQueryOptions());
  const { data: variables } = useQuery(variablesQueryOptions(projectId));
  const preview = usePreviewProjectClone(),
    start = useStartProjectClone();
  const [selected, setSelected] = useState<ProjectCloneJob | null>(null);
  const [error, setError] = useState("");
  const { fromDateTimeLocal, toDateTimeLocal } = useWorkspaceFormatters();
  const { timeZone } = useWorkspaceTime();
  const current = useQuery({
    ...projectCloneQueryOptions(projectId, selected?.id ?? ""),
    enabled: Boolean(selected),
    refetchInterval: (query) =>
      query.state.data && ["queued", "running"].includes(query.state.data.status) ? 2000 : false,
  });
  const job = current.data ?? selected;

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const overrides: ProjectCloneOptions["variables"] = {};
      for (const definition of variables?.effective.values ?? []) {
        const raw = getFormString(form, `variable:${definition.key}`);
        // An unchanged local display must retain the exact instant, including
        // sub-minute precision and the second occurrence of a repeated DST hour.
        if (
          definition.type === "datetime" &&
          typeof definition.value === "string" &&
          raw === toDateTimeLocal(definition.value)
        )
          continue;
        const value =
          definition.type === "number"
            ? Number(raw)
            : definition.type === "boolean"
              ? raw === "true"
              : definition.type === "datetime"
                ? fromDateTimeLocal(raw)
                : raw;
        if (value !== definition.value) overrides[definition.key] = value;
      }
      const review = getFormString(form, "reviewAt");
      const result = await preview.mutateAsync({
        id: projectId,
        options: {
          name: getFormString(form, "name"),
          ownerUserId: getFormString(form, "ownerUserId") || null,
          approverUserId: getFormString(form, "approverUserId") || null,
          reviewAt: review ? fromDateTimeLocal(review) : null,
          variables: overrides,
        },
      });
      setSelected(result);
    } catch (cause) {
      setError(getErrorMessage(cause, "複製内容を確認できませんでした"));
    }
  }
  async function begin() {
    if (!job) return;
    setError("");
    try {
      setSelected(await start.mutateAsync({ id: projectId, jobId: job.id, requestKey: job.id }));
    } catch (cause) {
      setError(getErrorMessage(cause, "複製を開始できませんでした"));
    }
  }
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="施策を複製"
      className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {!job ? (
        <form onSubmit={(event) => void prepare(event)} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="clone-name">複製先の名前</FieldLabel>
            <Input
              id="clone-name"
              name="name"
              defaultValue={`${projectName}（コピー）`}
              maxLength={191}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["ownerUserId", "approverUserId"] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`clone-${key}`}>
                  {key === "ownerUserId" ? "担当者" : "承認者"}
                </FieldLabel>
                <NativeSelect id={`clone-${key}`} name={key} defaultValue="">
                  <NativeSelectOption value="">選択してください</NativeSelectOption>
                  {options?.members.map((person) => (
                    <NativeSelectOption key={person.id} value={person.id}>
                      {person.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="clone-review">レビュー日（{timeZone}）</FieldLabel>
            <Input id="clone-review" name="reviewAt" type="datetime-local" />
          </Field>
          <p className="text-sm text-muted-foreground">
            ブリーフがある施策は、担当者・承認者・レビュー日の指定が必要です。
          </p>
          {(variables?.effective.values.length ?? 0) > 0 && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">複製先の変数</legend>
              {variables?.effective.values.map((definition) => (
                <CloneVariableInput key={definition.key} definition={definition} />
              ))}
            </fieldset>
          )}
          <LoadingButton type="submit" busy={preview.isPending}>
            コピー対象を確認
          </LoadingButton>
        </form>
      ) : job.status === "preview" ? (
        <div className="space-y-4">
          <p>
            <strong>{job.options.name}</strong>へ、以下の内容をコピーします。
          </p>
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">種類</th>
                  <th className="p-2">名前</th>
                  <th className="p-2">複製先スラッグ</th>
                </tr>
              </thead>
              <tbody>
                {job.resources.map((resource) => (
                  <tr className="border-b" key={`${resource.kind}:${resource.sourceId}`}>
                    <td className="p-2">{kindLabels[resource.kind]}</td>
                    <td className="p-2">{resource.name}</td>
                    <td className="p-2 break-all">{resource.targetSlug ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {job.sharedReferences.length > 0 && (
            <div>
              <h3 className="font-medium">共有する参照先</h3>
              <ul className="list-disc pl-5 text-sm">
                {job.sharedReferences.map((reference) => (
                  <li key={`${reference.kind}:${reference.id}`}>
                    {reference.name}（{reference.kind}）
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            参加者・費用・成果・実行履歴は引き継がれません。複製先は下書きです。承認・公開・有効化を行って利用を開始してください。
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>
              設定に戻る
            </Button>
            <LoadingButton busy={start.isPending} onClick={() => void begin()}>
              この内容で複製
            </LoadingButton>
          </div>
        </div>
      ) : (
        <CloneJobProgress job={job} canEdit />
      )}
    </AppDialog>
  );
}

function CloneVariableInput({ definition }: { definition: VariableDefinition }) {
  const { toDateTimeLocal } = useWorkspaceFormatters();
  return (
    <Field>
      <FieldLabel htmlFor={`clone-variable-${definition.key}`}>
        {definition.key}（{definition.type}）
      </FieldLabel>
      {definition.type === "boolean" ? (
        <NativeSelect
          id={`clone-variable-${definition.key}`}
          name={`variable:${definition.key}`}
          defaultValue={String(definition.value)}
        >
          <NativeSelectOption value="true">はい</NativeSelectOption>
          <NativeSelectOption value="false">いいえ</NativeSelectOption>
        </NativeSelect>
      ) : (
        <Input
          id={`clone-variable-${definition.key}`}
          name={`variable:${definition.key}`}
          type={
            definition.type === "datetime"
              ? "datetime-local"
              : definition.type === "number"
                ? "number"
                : definition.type === "url"
                  ? "url"
                  : "text"
          }
          step={definition.type === "number" ? "any" : undefined}
          defaultValue={
            definition.type === "datetime"
              ? toDateTimeLocal(String(definition.value))
              : String(definition.value)
          }
        />
      )}
    </Field>
  );
}
