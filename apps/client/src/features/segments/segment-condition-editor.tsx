import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  getSegmentFieldDefinition,
  type SegmentCondition,
  type SegmentField,
  type SegmentGenerationCatalog,
  type SegmentOperator,
} from "@openengage/core/segments";

import {
  createDefaultSegmentCondition,
  customFieldOperatorAllowed,
  rawSegmentConditionValue,
  segmentOptionsForField,
} from "./segment-builder-model";
import { SegmentConditionValueEditor } from "./segment-condition-value-editor";
import {
  createSegmentCondition,
  getSegmentOperatorOptions,
  segmentConditionNeedsValue,
  segmentFieldOptions,
} from "./segment-fields";

export function SegmentConditionEditor({
  condition,
  catalog,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition;
  catalog: SegmentGenerationCatalog;
  onChange: (condition: SegmentCondition) => void;
  onRemove?: () => void;
}): ReactNode {
  const definition = getSegmentFieldDefinition(condition.field);
  const customField =
    condition.field === "custom_field"
      ? catalog.customFields.find((option) => option.value === condition.key)
      : undefined;
  const operators = getSegmentOperatorOptions(condition.field).filter(
    ({ operator }) =>
      condition.field !== "custom_field" ||
      !customField?.dataType ||
      customFieldOperatorAllowed(customField.dataType, operator),
  );

  function changeOperator(operator: SegmentOperator): void {
    onChange(
      createSegmentCondition(
        condition.field,
        operator,
        rawSegmentConditionValue(condition),
        condition.key,
        customField?.dataType,
      ),
    );
  }

  function changeValue(rawValue: string): void {
    if (definition.valueType === "number" && !rawValue.trim()) return;
    onChange(
      createSegmentCondition(
        condition.field,
        condition.operator,
        rawValue,
        condition.key,
        customField?.dataType,
      ),
    );
  }

  return (
    <div className="grid gap-2 rounded-md border bg-background p-2 md:grid-cols-[1fr_1fr_1.4fr_auto]">
      <NativeSelect
        value={condition.field}
        aria-label="フィールド"
        onChange={(event) =>
          onChange(createDefaultSegmentCondition(event.target.value as SegmentField, catalog))
        }
      >
        {segmentFieldOptions.map((option) => (
          <NativeSelectOption key={option.field} value={option.field}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        value={condition.operator}
        aria-label="演算子"
        onChange={(event) => changeOperator(event.target.value as SegmentOperator)}
      >
        {operators.map((option) => (
          <NativeSelectOption key={option.operator} value={option.operator}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <SegmentConditionValueEditor
        condition={condition}
        catalog={catalog}
        options={segmentOptionsForField(condition.field, catalog)}
        customField={customField}
        needsValue={segmentConditionNeedsValue(condition.field, condition.operator)}
        onChange={onChange}
        onValueChange={changeValue}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!onRemove}
        aria-label="条件を削除"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
