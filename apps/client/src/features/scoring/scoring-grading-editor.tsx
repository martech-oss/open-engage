import type { FormEvent, ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { FieldGroup } from "@/components/ui/field";
import { GRADING_FIELDS, GRADING_OPERATORS } from "@openengage/core/scoring";

import type { GradingCriterionRow } from "./scoring-api";
import { GRADING_FIELD_LABELS, GRADING_OPERATOR_LABELS } from "./scoring-labels";

export type GradingCriterionEditorViewProps = {
  item: GradingCriterionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
  field: GradingCriterionRow["field"];
  onFieldChange: (field: GradingCriterionRow["field"]) => void;
};

export function GradingCriterionEditorView({
  item,
  open,
  onOpenChange,
  onSubmit,
  busy,
  error,
  field,
  onFieldChange,
}: GradingCriterionEditorViewProps): ReactNode {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "グレード条件を編集" : "グレード条件を追加"}
      description="連絡先の属性がこの条件に合致すると、グレードを上下させます。"
      className="sm:max-w-2xl"
      onSubmit={onSubmit}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "条件を追加"}
    >
      <FormInput
        label="条件名"
        name="name"
        defaultValue={item?.name}
        placeholder="意思決定者の役職"
        required
      />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormNativeSelect
          label="対象フィールド"
          name="field"
          defaultValue={item?.field ?? "custom_field"}
          onChange={(event) =>
            onFieldChange(event.currentTarget.value as GradingCriterionRow["field"])
          }
        >
          {GRADING_FIELDS.map((value) => (
            <FormSelectOption key={value} value={value}>
              {GRADING_FIELD_LABELS[value] ?? value}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="演算子"
          name="operator"
          defaultValue={item?.operator ?? "contains"}
        >
          {GRADING_OPERATORS.map((value) => (
            <FormSelectOption key={value} value={value}>
              {GRADING_OPERATOR_LABELS[value]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      {field === "custom_field" ? (
        <FormInput
          label="カスタムフィールドのキー"
          name="fieldKey"
          defaultValue={item?.fieldKey ?? ""}
          placeholder="job_title"
          required
        />
      ) : null}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="値"
          name="value"
          defaultValue={item?.value ?? ""}
          description="「値がある / ない」を選んだ場合は空欄で構いません。"
          placeholder="部長"
        />
        <FormInput
          label="移動量（3分の1文字）"
          name="steps"
          type="number"
          min={-6}
          max={6}
          defaultValue={item?.steps ?? 1}
          description="+3 で1文字ぶん上がります。"
          required
        />
      </FieldGroup>
      <FormNativeSelect
        label="状態"
        name="enabled"
        defaultValue={item && !item.enabled ? "disabled" : "enabled"}
      >
        <FormSelectOption value="enabled">有効</FormSelectOption>
        <FormSelectOption value="disabled">停止中</FormSelectOption>
      </FormNativeSelect>
    </FormDialog>
  );
}
