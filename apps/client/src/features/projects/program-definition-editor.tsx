import { useState } from "react";

import { ErrorAlert, FormInput, LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  PROJECT_PROGRAM_TEMPLATES,
  projectProgramDefinitionSchema,
  type ProjectProgramDefinition,
  type ProjectProgramStatus,
} from "@openengage/core/projects";

import { ProgramSelect } from "./program-fields";

export function ProgramDefinitionEditor({
  definition,
  editable,
  publishable,
  publishedVersion,
  busy,
  onSave,
  onPublish,
}: {
  definition: ProjectProgramDefinition;
  editable: boolean;
  publishable: boolean;
  publishedVersion: number | null;
  busy: boolean;
  onSave: (definition: ProjectProgramDefinition) => void;
  onPublish: () => void;
}) {
  const [draft, setDraft] = useState(definition);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(definition);
  function updateDraft(next: ProjectProgramDefinition) {
    setConfirmed(false);
    setDraft(next);
  }
  function updateStatus(index: number, patch: Partial<ProjectProgramStatus>) {
    setConfirmed(false);
    const beforeId = draft.statuses[index]!.id;
    const afterId = patch.id ?? beforeId;
    updateDraft({
      ...draft,
      initialStatusId: draft.initialStatusId === beforeId ? afterId : draft.initialStatusId,
      statuses: draft.statuses.map((s, i) => ({
        ...(i === index ? { ...s, ...patch } : s),
        nextStatusIds: (i === index
          ? (patch.nextStatusIds ?? s.nextStatusIds)
          : s.nextStatusIds
        ).map((id) => (id === beforeId ? afterId : id)),
      })),
    });
  }
  function removeStatus(index: number) {
    setConfirmed(false);
    const removed = draft.statuses[index]!.id;
    const statuses = draft.statuses
      .filter((_, i) => i !== index)
      .map((status) => ({
        ...status,
        nextStatusIds: status.nextStatusIds.filter((id) => id !== removed),
      }));
    updateDraft({
      ...draft,
      statuses,
      initialStatusId: draft.initialStatusId === removed ? statuses[0]!.id : draft.initialStatusId,
    });
  }
  function save() {
    const parsed = projectProgramDefinitionSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" / "));
      return;
    }
    setError("");
    onSave(parsed.data);
  }
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">参加ステータスの定義</h2>
        <p className="text-sm text-muted-foreground">
          公開中: {publishedVersion ? `第${publishedVersion}版` : "未公開"}
          。新しい定義は公開後の参加者に適用します。既存参加者と成果履歴は登録時の版を保持します。
        </p>
      </div>
      {!editable && (
        <p className="text-sm">
          承認済みブリーフの定義変更は、ブリーフを再編集して下書きに戻してから編集し、再承認後に公開してください。
        </p>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <fieldset disabled={!editable || busy} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ProgramSelect
            name="program-kind"
            label="施策種別"
            value={draft.kind}
            onChange={(e) =>
              updateDraft({ ...draft, kind: e.target.value as ProjectProgramDefinition["kind"] })
            }
            options={[
              { value: "resource_request", label: "資料請求" },
              { value: "inquiry", label: "問い合わせ" },
              { value: "event", label: "イベント" },
              { value: "custom", label: "カスタム" },
            ]}
          />
          <ProgramSelect
            name="initial-status"
            label="初期ステータス"
            value={draft.initialStatusId}
            onChange={(e) => updateDraft({ ...draft, initialStatusId: e.target.value })}
            options={draft.statuses.map((s) => ({ value: s.id, label: s.label }))}
          />
          <ProgramSelect
            name="program-template"
            label="テンプレートから設定"
            value=""
            onChange={(e) => {
              const template =
                PROJECT_PROGRAM_TEMPLATES[e.target.value as keyof typeof PROJECT_PROGRAM_TEMPLATES];
              if (template) {
                updateDraft(structuredClone(template));
                setConfirmed(false);
              }
            }}
            options={[
              { value: "", label: "テンプレートを選択" },
              { value: "resource_request", label: "資料請求" },
              { value: "inquiry", label: "問い合わせ" },
              { value: "event", label: "イベント" },
            ]}
          />
        </div>
        {draft.statuses.map((status, index) => (
          <div key={index} className="space-y-3 rounded-lg border p-3">
            <div className="grid items-end gap-3 md:grid-cols-3">
              <FormInput
                name={`status-id-${index}`}
                label="ステータスID"
                value={status.id}
                onChange={(e) => updateStatus(index, { id: e.target.value })}
              />
              <FormInput
                name={`status-label-${index}`}
                label="表示名"
                value={status.label}
                onChange={(e) => updateStatus(index, { label: e.target.value })}
              />
              <label className="flex items-center gap-2 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={status.success}
                  onChange={(e) => updateStatus(index, { success: e.target.checked })}
                />
                成果として数える
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>次に進めるステータス:</span>
              {draft.statuses
                .filter((s) => s.id !== status.id)
                .map((next) => (
                  <label key={next.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={status.nextStatusIds.includes(next.id)}
                      onChange={(e) =>
                        updateStatus(index, {
                          nextStatusIds: e.target.checked
                            ? [...status.nextStatusIds, next.id]
                            : status.nextStatusIds.filter((id) => id !== next.id),
                        })
                      }
                    />
                    {next.label}
                  </label>
                ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={draft.statuses.length === 1}
                onClick={() => removeStatus(index)}
              >
                削除
              </Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              updateDraft({
                ...draft,
                statuses: [
                  ...draft.statuses,
                  {
                    id: `status_${draft.statuses.length + 1}`,
                    label: "新しいステータス",
                    success: false,
                    nextStatusIds: [],
                  },
                ],
              })
            }
          >
            ステータス追加
          </Button>
          <LoadingButton busy={busy} onClick={save}>
            定義を下書き保存
          </LoadingButton>
        </div>
      </fieldset>
      {publishable && (
        <div className="space-y-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={dirty || busy}
            />
            変更内容を確認しました。既存参加者は元の定義版を維持します。
          </label>
          {dirty && <p className="text-sm">変更を下書き保存してから公開してください。</p>}
          <LoadingButton busy={busy} disabled={!confirmed || dirty} onClick={onPublish}>
            この定義を公開
          </LoadingButton>
        </div>
      )}
    </section>
  );
}
