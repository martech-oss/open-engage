import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  getSegmentFieldDefinition,
  type SegmentCondition,
  type SegmentGenerationCatalog,
  type SegmentResourceOption,
} from "@openengage/core/segments";

import { programStatusSelection } from "./program-segment-options";
import { RichSegmentConditionValueEditor } from "./rich-segment-condition-value-editor";
import {
  defaultSegmentRawValue,
  normalizeCustomFieldOperator,
  rawSegmentConditionValue,
  type SegmentDefaultValues,
} from "./segment-builder-model";
import { createSegmentCondition, normalizeSegmentOperator } from "./segment-fields";

export function SegmentConditionValueEditor({
  condition,
  catalog,
  defaults,
  options,
  customField,
  needsValue,
  onChange,
  onValueChange,
}: {
  condition: SegmentCondition;
  catalog: SegmentGenerationCatalog;
  defaults: SegmentDefaultValues;
  options: SegmentResourceOption[];
  customField: SegmentResourceOption | undefined;
  needsValue: boolean;
  onChange: (condition: SegmentCondition) => void;
  onValueChange: (value: string) => void;
}): ReactNode {
  if (["category_score", "company_custom_field", "event_property"].includes(condition.field)) {
    return (
      <RichSegmentConditionValueEditor
        condition={condition}
        catalog={catalog}
        needsValue={needsValue}
        onChange={onChange}
      />
    );
  }
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
                defaultSegmentRawValue(selected?.dataType, defaults),
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
        value={programStatusSelection(condition)}
        aria-label="条件値"
        onChange={(event) => {
          if (condition.field !== "project_status") return onValueChange(event.target.value);
          const selected = options.find(
            (option) => option.value === event.target.value,
          )?.programStatus;
          onChange({
            ...condition,
            value:
              condition.operator === "in"
                ? [selected?.statusId ?? event.target.value]
                : (selected?.statusId ?? event.target.value),
            program: selected
              ? { projectId: selected.projectId, definitionVersion: selected.definitionVersion }
              : undefined,
          });
        }}
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
