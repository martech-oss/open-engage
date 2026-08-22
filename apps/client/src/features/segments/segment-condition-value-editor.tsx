import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  getSegmentFieldDefinition,
  type SegmentCondition,
  type SegmentGenerationCatalog,
  type SegmentResourceOption,
} from "@openengage/core/segments";

import {
  defaultSegmentRawValue,
  normalizeCustomFieldOperator,
  rawSegmentConditionValue,
} from "./segment-builder-model";
import { createSegmentCondition, normalizeSegmentOperator } from "./segment-fields";

export function SegmentConditionValueEditor({
  condition,
  catalog,
  options,
  customField,
  needsValue,
  onChange,
  onValueChange,
}: {
  condition: SegmentCondition;
  catalog: SegmentGenerationCatalog;
  options: SegmentResourceOption[];
  customField: SegmentResourceOption | undefined;
  needsValue: boolean;
  onChange: (condition: SegmentCondition) => void;
  onValueChange: (value: string) => void;
}): ReactNode {
  if (condition.field === "event" || condition.field === "custom_field") {
    const keyedOptions = condition.field === "event" ? catalog.events : catalog.customFields;
    return (
      <div className="flex min-w-0 gap-2">
        <NativeSelect
          className="min-w-0 flex-1"
          value={condition.key ?? ""}
          aria-label={condition.field === "event" ? "イベント" : "カスタム項目"}
          onChange={(event) => {
            const key = event.target.value;
            const selected = keyedOptions.find((item) => item.value === key);
            const operator =
              condition.field === "custom_field" && selected?.dataType
                ? normalizeCustomFieldOperator(selected.dataType, condition.operator)
                : normalizeSegmentOperator(condition.field, condition.operator);
            onChange(
              createSegmentCondition(
                condition.field,
                operator,
                defaultSegmentRawValue(selected?.dataType),
                key,
                selected?.dataType,
              ),
            );
          }}
        >
          {keyedOptions.map((option) => (
            <NativeSelectOption key={option.id} value={option.value}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {condition.field === "custom_field" && needsValue ? (
          <Input
            className="min-w-0 flex-1"
            aria-label="条件値"
            type={customField?.dataType === "number" ? "number" : "text"}
            value={rawSegmentConditionValue(condition)}
            onChange={(event) => onValueChange(event.target.value)}
          />
        ) : null}
      </div>
    );
  }
  if (options.length > 0) {
    return (
      <NativeSelect
        value={String(condition.value ?? "")}
        aria-label="条件値"
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.value}>
            {option.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  if (!needsValue) return <span className="self-center text-sm text-muted-foreground">値なし</span>;
  if (condition.field === "status") {
    return (
      <NativeSelect
        value={String(condition.value)}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <NativeSelectOption value="active">active</NativeSelectOption>
        <NativeSelectOption value="anonymous">anonymous</NativeSelectOption>
      </NativeSelect>
    );
  }
  if (condition.field === "stage" && catalog.stages.length > 0) {
    return (
      <NativeSelect
        value={String(condition.value)}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {catalog.stages.map((stage) => (
          <NativeSelectOption key={stage} value={stage}>
            {stage}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  const valueType = getSegmentFieldDefinition(condition.field).valueType;
  return (
    <Input
      aria-label="条件値"
      type={valueType === "number" ? "number" : valueType === "date" ? "datetime-local" : "text"}
      value={rawSegmentConditionValue(condition)}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
