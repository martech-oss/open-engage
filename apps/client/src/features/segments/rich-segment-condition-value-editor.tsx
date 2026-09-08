import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { SegmentCondition, SegmentGenerationCatalog } from "@openengage/core/segments";

import { rawSegmentConditionValue } from "./segment-builder-model";
import { createSegmentCondition } from "./segment-fields";

export function RichSegmentConditionValueEditor({
  condition,
  catalog,
  needsValue,
  onChange,
}: {
  condition: SegmentCondition;
  catalog: SegmentGenerationCatalog;
  needsValue: boolean;
  onChange: (condition: SegmentCondition) => void;
}): ReactNode {
  const keyedOptions =
    condition.field === "category_score"
      ? (catalog.categories ?? [])
      : condition.field === "company_custom_field"
        ? (catalog.companyCustomFields ?? [])
        : [];
  const selected = keyedOptions.find((option) => option.value === condition.key);
  const valueType =
    condition.field === "category_score"
      ? "number"
      : (selected?.dataType ??
        (typeof condition.value === "number"
          ? "number"
          : typeof condition.value === "boolean"
            ? "boolean"
            : "text"));
  return (
    <div className="flex flex-wrap gap-2">
      {condition.field === "event_property" ? (
        <Input
          aria-label="イベント属性キー"
          value={condition.key ?? ""}
          onChange={(event) => onChange({ ...condition, key: event.target.value })}
        />
      ) : (
        <NativeSelect
          aria-label="対象項目"
          value={condition.key ?? ""}
          onChange={(event) => onChange({ ...condition, key: event.target.value })}
        >
          <NativeSelectOption value="">選択してください</NativeSelectOption>
          {keyedOptions.map((option) => (
            <NativeSelectOption key={option.id} value={option.value}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      {condition.field === "event_property" && (
        <NativeSelect
          aria-label="属性の値型"
          value={valueType}
          onChange={(event) =>
            onChange({
              ...condition,
              value:
                event.target.value === "number" ? 0 : event.target.value === "boolean" ? false : "",
            })
          }
        >
          <NativeSelectOption value="text">文字列</NativeSelectOption>
          <NativeSelectOption value="number">数値</NativeSelectOption>
          <NativeSelectOption value="boolean">真偽値</NativeSelectOption>
        </NativeSelect>
      )}
      {needsValue && (
        <Input
          aria-label="条件値"
          type={valueType === "number" ? "number" : "text"}
          value={rawSegmentConditionValue(condition)}
          onChange={(event) =>
            onChange(
              createSegmentCondition(
                condition.field,
                condition.operator,
                event.target.value,
                condition.key,
                valueType,
              ),
            )
          }
        />
      )}
    </div>
  );
}
