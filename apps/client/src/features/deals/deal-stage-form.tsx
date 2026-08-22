import { type FormEvent, type ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import type { DealStage } from "@/features/deals/deal-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";

export type DealStageDraft = Pick<DealStage, "name" | "color" | "probability">;

export function DealStageForm({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: DealStageDraft | null;
  onSubmit: (values: DealStageDraft) => Promise<void>;
}): ReactNode {
  const editing = initial !== null;
  const { busy, error, run } = useFormSubmission(
    editing ? "ステージを更新できませんでした" : "ステージを追加できませんでした",
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await onSubmit({
        name: getFormString(form, "name").trim(),
        color: getFormString(form, "color") || "#64748b",
        probability: Math.min(100, Math.max(0, Number(getFormString(form, "probability") || "0"))),
      });
      onOpenChange(false);
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "ステージを編集" : "ステージを追加"}
      description="このパイプライン専用のステージです。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={editing ? "更新" : "追加"}
    >
      <FormInput
        label="名前"
        name="name"
        placeholder="例：提案"
        defaultValue={initial?.name ?? ""}
        required
      />
      <FormInput
        label="カラー"
        name="color"
        type="color"
        defaultValue={initial?.color ?? "#64748b"}
        required
      />
      <FormInput
        label="成約確度（%）"
        name="probability"
        type="number"
        min={0}
        max={100}
        defaultValue={String(initial?.probability ?? 0)}
      />
    </FormDialog>
  );
}
