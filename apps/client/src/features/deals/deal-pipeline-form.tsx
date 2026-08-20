import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ArchiveConfirm, FormDialog, FormInput } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { defaultDealStages } from "@openengage/core/deals";

import {
  useArchiveDealPipeline,
  useCreateDealPipeline,
  useUpdateDealPipeline,
  type DealPipeline,
} from "./deal-api";

type DraftStage = {
  key: string;
  id?: string;
  name: string;
  color: string;
  probability: number;
};

function draftStages(pipeline: DealPipeline | null, keepIds: boolean): DraftStage[] {
  const source = pipeline?.stages.length ? pipeline.stages : defaultDealStages;
  return source.map((stage, index) => ({
    key: keepIds && "id" in stage ? stage.id : `new-${index}`,
    ...(keepIds && "id" in stage ? { id: stage.id } : {}),
    name: stage.name,
    color: stage.color,
    probability: stage.probability,
  }));
}

export function DealPipelineForm({
  open,
  onOpenChange,
  pipeline,
  sourcePipeline,
  canArchive,
  onCreated,
  onArchived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: DealPipeline | null;
  sourcePipeline: DealPipeline | null;
  canArchive: boolean;
  onCreated: (pipelineId: string) => Promise<void>;
  onArchived: () => Promise<void>;
}): ReactNode {
  const createPipeline = useCreateDealPipeline();
  const updatePipeline = useUpdateDealPipeline();
  const archivePipeline = useArchiveDealPipeline();
  const editing = pipeline !== null;
  const { busy, error, run, setError } = useFormSubmission(
    editing ? "パイプラインを更新できませんでした" : "パイプラインを作成できませんでした",
  );
  const [isDefault, setIsDefault] = useState(pipeline?.isDefault ?? false);
  const [stages, setStages] = useState<DraftStage[]>(() =>
    draftStages(editing ? pipeline : sourcePipeline, editing),
  );

  function updateStage(key: string, patch: Partial<DraftStage>): void {
    setStages((current) =>
      current.map((stage) => (stage.key === key ? { ...stage, ...patch } : stage)),
    );
  }

  function moveStage(index: number, direction: -1 | 1): void {
    const next = index + direction;
    if (next < 0 || next >= stages.length) return;
    setStages((current) => {
      const copy = [...current];
      const [removed] = copy.splice(index, 1);
      if (!removed) return current;
      copy.splice(next, 0, removed);
      return copy;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = getFormString(new FormData(event.currentTarget), "name").trim();
    const payload = {
      name,
      isDefault,
      stages: stages.map((stage) => ({
        ...(stage.id ? { id: stage.id } : {}),
        name: stage.name.trim(),
        color: stage.color,
        probability: stage.probability,
      })),
    };
    await run(async () => {
      if (pipeline) {
        await updatePipeline.mutateAsync({ id: pipeline.id, ...payload });
        toast.success("パイプラインを更新しました");
        onOpenChange(false);
        return;
      }
      const created = await createPipeline.mutateAsync(payload);
      toast.success("パイプラインを作成しました");
      onOpenChange(false);
      await onCreated(created.id);
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "パイプラインを編集" : "パイプラインを作成"}
      {...(editing ? {} : { description: "商談の進捗を追うステージを定義します。" })}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={editing ? "更新" : "作成"}
      className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
    >
      <FormInput
        label="名前"
        name="name"
        placeholder="例：インバウンド"
        defaultValue={pipeline?.name ?? ""}
        required
      />
      <Field orientation="horizontal">
        <Checkbox
          id="pipeline-default"
          checked={isDefault}
          disabled={pipeline?.isDefault ?? false}
          onCheckedChange={(checked) => setIsDefault(Boolean(checked))}
        />
        <FieldContent>
          <FieldLabel htmlFor="pipeline-default">
            <FieldTitle>デフォルトのパイプラインにする</FieldTitle>
          </FieldLabel>
          {pipeline?.isDefault ? (
            <FieldDescription>別のパイプラインをデフォルトにすると変更できます。</FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
      <FieldSet>
        <FieldLegend>ステージ</FieldLegend>
        <div className="grid gap-2">
          {stages.map((stage, index) => (
            <div
              key={stage.key}
              className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_5rem_auto] sm:items-end"
            >
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="上へ"
                  disabled={index === 0}
                  onClick={() => moveStage(index, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="下へ"
                  disabled={index === stages.length - 1}
                  onClick={() => moveStage(index, 1)}
                >
                  <ChevronDown />
                </Button>
              </div>
              <Field>
                <FieldLabel htmlFor={`stage-name-${stage.key}`}>名前</FieldLabel>
                <Input
                  id={`stage-name-${stage.key}`}
                  value={stage.name}
                  onChange={(event) => updateStage(stage.key, { name: event.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`stage-color-${stage.key}`}>カラー</FieldLabel>
                <Input
                  id={`stage-color-${stage.key}`}
                  type="color"
                  value={stage.color}
                  onChange={(event) => updateStage(stage.key, { color: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`stage-probability-${stage.key}`}>確度</FieldLabel>
                <Input
                  id={`stage-probability-${stage.key}`}
                  type="number"
                  min={0}
                  max={100}
                  value={stage.probability}
                  onChange={(event) =>
                    updateStage(stage.key, {
                      probability: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
              </Field>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`${stage.name || "ステージ"}を削除`}
                disabled={stages.length <= 1}
                onClick={() =>
                  setStages((current) => current.filter((item) => item.key !== stage.key))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={stages.length >= 20}
          onClick={() =>
            setStages((current) => [
              ...current,
              {
                key: `new-${crypto.randomUUID()}`,
                name: "",
                color: "#64748b",
                probability: 0,
              },
            ])
          }
        >
          <Plus data-icon="inline-start" />
          ステージを追加
        </Button>
      </FieldSet>
      {editing && canArchive ? (
        <ArchiveConfirm
          label={pipeline.name}
          title="パイプラインをアーカイブしますか？"
          description={`「${pipeline.name}」を一覧から外します。商談が残っているパイプラインはアーカイブできません。`}
          trigger={
            <Button type="button" variant="outline">
              アーカイブ
            </Button>
          }
          onConfirm={async () => {
            try {
              await archivePipeline.mutateAsync({ id: pipeline.id });
              toast.success("パイプラインをアーカイブしました");
              onOpenChange(false);
              await onArchived();
            } catch (caught) {
              setError(getErrorMessage(caught, "パイプラインをアーカイブできませんでした"));
            }
          }}
        />
      ) : null}
    </FormDialog>
  );
}
