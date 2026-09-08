import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { signupFormsQueryOptions } from "@/features/website/website-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { ProjectProgramDetail } from "@openengage/core/projects";

import { useBindProgramForm } from "./program-api";
import { ProgramSelect } from "./program-fields";
export function ProgramFormBindings({ detail }: { detail: ProjectProgramDetail }) {
  const forms = useQuery(signupFormsQueryOptions());
  const [formId, setFormId] = useState("");
  const [statusId, setStatusId] = useState(
    detail.program?.publishedDefinition?.initialStatusId ?? "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const mutation = useBindProgramForm();
  const version = detail.program?.publishedVersion;
  const canEdit = detail.allowedActions.publishDefinition && Boolean(version);
  async function save(selectedFormId: string, remove = false) {
    setError("");
    try {
      await mutation.mutateAsync({
        id: detail.project.id,
        formId: selectedFormId,
        binding: remove
          ? null
          : { projectId: detail.project.id, definitionVersion: version!, statusId },
        confirmed: true,
      });
      setConfirmed(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "フォームの参加先を保存できませんでした"));
    }
  }
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">フォームからの参加</h2>
      <p className="text-sm text-muted-foreground">
        共有フォームでも参加先はここで指定した施策です。LPの計測施策と一致する必要があります。既存のLP公開版は保存済みの参加先を維持するため、変更後はフォームとLPを再公開してください。
      </p>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <ul className="space-y-2">
        {detail.formBindings.map((binding) => (
          <li
            key={binding.formId}
            className="flex items-center justify-between gap-3 rounded border p-3 text-sm"
          >
            <span>
              {binding.formName} → {binding.statusId} ·{" "}
              {binding.definitionVersion
                ? `第${binding.definitionVersion}版`
                : "未公開の参加先（施策公開後にフォーム公開）"}
            </span>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => void save(binding.formId, true)}
              >
                紐付け解除
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <ProgramSelect
              name="binding-form"
              label="フォーム"
              value={formId}
              onChange={(e) => {
                setFormId(e.target.value);
                setConfirmed(false);
              }}
              options={[
                { value: "", label: "フォームを選択" },
                ...(forms.data ?? []).map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
            <ProgramSelect
              name="binding-status"
              label="送信時の登録・更新先"
              value={statusId}
              onChange={(e) => {
                setStatusId(e.target.value);
                setConfirmed(false);
              }}
              options={(detail.program?.publishedDefinition?.statuses ?? []).map((s) => ({
                value: s.id,
                label: s.label,
              }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            このフォームの参加先と更新先を確認しました
          </label>
          <LoadingButton
            busy={mutation.isPending}
            disabled={!confirmed || !formId || !statusId}
            onClick={() => void save(formId)}
          >
            フォーム参加先を保存
          </LoadingButton>
        </div>
      )}
    </section>
  );
}
