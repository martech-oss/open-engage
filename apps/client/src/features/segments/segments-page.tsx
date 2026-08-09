import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Shapes } from "lucide-react";
import { type ReactNode, type FormEvent, useState } from "react";

import {
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
  ResourceCard,
  ResourceGrid,
  SimpleEmpty,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { segmentsQueryOptions, useCreateSegment } from "@/features/segments/segment-api";
import {
  createSegmentCondition,
  getSegmentOperatorOptions,
  normalizeSegmentOperator,
  segmentConditionNeedsValue,
  segmentFieldOptions,
} from "@/features/segments/segment-fields";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { formatDateTime } from "@/lib/format";
import { slugify } from "@/lib/utils";
import {
  getSegmentFieldDefinition,
  type SegmentField,
  type SegmentFilter,
  type SegmentOperator,
  type SegmentRow,
} from "@openengage/core/segments";

export type { SegmentRow };

export function SegmentsPage(): ReactNode {
  const { data: segments } = useSuspenseQuery(segmentsQueryOptions());
  const [showForm, setShowForm] = useState(false);

  return (
    <PageLayout
      title="セグメント"
      action={
        <Button onClick={() => setShowForm(true)}>
          <Plus data-icon="inline-start" />
          セグメントを作成
        </Button>
      }
    >
      <ResourceGrid>
        {segments.map((segment) => (
          <ResourceCard
            key={segment.id}
            icon={<Shapes />}
            title={segment.name}
            subtitle={`${segment.kind} · ${segment.memberCount} contacts`}
            footer={formatDateTime(segment.updatedAt)}
          />
        ))}
      </ResourceGrid>
      {segments.length === 0 ? <SimpleEmpty label="最初のセグメントを作成しましょう" /> : null}
      <SegmentFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onSaved={async () => {
          setShowForm(false);
        }}
      />
    </PageLayout>
  );
}

function SegmentFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const createSegment = useCreateSegment();
  const { busy, error, run } = useFormSubmission("セグメントを作成できませんでした");
  const [kind, setKind] = useState<"static" | "dynamic">("static");
  const [field, setField] = useState<SegmentField>("stage");
  const [operator, setOperator] = useState<SegmentOperator>("eq");
  const fieldDefinition = getSegmentFieldDefinition(field);
  const operatorOptions = getSegmentOperatorOptions(field);
  const needsValue = segmentConditionNeedsValue(field, operator);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = getFormString(form, "name");
    const filter: SegmentFilter | undefined =
      kind === "dynamic"
        ? createSegmentCondition(field, operator, getFormString(form, "value"))
        : undefined;
    await run(async () => {
      await createSegment.mutateAsync({
        name,
        slug: slugify(name),
        kind,
        ...(filter ? { filter } : {}),
      });
      await onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="セグメントを作成"
      description="連絡先を手動でまとめる静的セグメント、または条件から自動更新される動的セグメントを作成します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="作成"
    >
      <FormInput label="名前" name="name" required />
      <FormNativeSelect
        label="種類"
        name="kind"
        value={kind}
        onChange={(event) => setKind(event.target.value as "static" | "dynamic")}
      >
        <FormSelectOption value="static">静的(連絡先を手動で追加)</FormSelectOption>
        <FormSelectOption value="dynamic">動的(条件に一致する連絡先を自動更新)</FormSelectOption>
      </FormNativeSelect>
      {kind === "dynamic" && (
        <>
          <FieldGroup className="grid grid-cols-2 gap-3">
            <FormNativeSelect
              label="フィールド"
              name="field"
              value={field}
              onChange={(event) => {
                const nextField = event.target.value as SegmentField;
                setField(nextField);
                setOperator((current) => normalizeSegmentOperator(nextField, current));
              }}
            >
              {segmentFieldOptions.map((option) => (
                <FormSelectOption key={option.field} value={option.field}>
                  {option.label}
                </FormSelectOption>
              ))}
            </FormNativeSelect>
            <FormNativeSelect
              label="演算子"
              name="operator"
              value={operator}
              onChange={(event) => setOperator(event.target.value as SegmentOperator)}
            >
              {operatorOptions.map((option) => (
                <FormSelectOption key={option.operator} value={option.operator}>
                  {option.label}
                </FormSelectOption>
              ))}
            </FormNativeSelect>
          </FieldGroup>
          {needsValue ? (
            <FormInput
              label="値"
              name="value"
              type={
                operator === "in"
                  ? "text"
                  : fieldDefinition.valueType === "number"
                    ? "number"
                    : fieldDefinition.valueType === "date"
                      ? "datetime-local"
                      : "text"
              }
              {...(operator === "in"
                ? { description: "複数の値はカンマで区切って入力します。" }
                : {})}
              required
            />
          ) : (
            <input type="hidden" name="value" value="" />
          )}
        </>
      )}
    </FormDialog>
  );
}
