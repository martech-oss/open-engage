import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  getSegmentFieldDefinition,
  type SegmentCondition,
  type SegmentField,
  type SegmentFilter,
  type SegmentGenerationCatalog,
  type SegmentOperator,
  type SegmentResourceOption,
} from "@openengage/core/segments";

import {
  createSegmentCondition,
  getSegmentOperatorOptions,
  normalizeSegmentOperator,
  segmentConditionNeedsValue,
  segmentFieldOptions,
} from "./segment-fields";

export function SegmentBuilder({
  value,
  catalog,
  onChange,
}: {
  value: SegmentFilter;
  catalog: SegmentGenerationCatalog;
  onChange: (filter: SegmentFilter) => void;
}): ReactNode {
  return (
    <FilterNodeEditor
      node={value}
      path={[]}
      catalog={catalog}
      onReplace={(path, node) => onChange(replaceNode(value, path, node))}
      onRemove={(path) => onChange(removeNode(value, path))}
    />
  );
}

function FilterNodeEditor({
  node,
  path,
  catalog,
  onReplace,
  onRemove,
}: {
  node: SegmentFilter;
  path: number[];
  catalog: SegmentGenerationCatalog;
  onReplace: (path: number[], node: SegmentFilter) => void;
  onRemove: (path: number[]) => void;
}): ReactNode {
  if (node.kind === "condition") {
    return (
      <ConditionEditor
        condition={node}
        catalog={catalog}
        onChange={(condition) => onReplace(path, condition)}
        {...(path.length === 0 ? {} : { onRemove: () => onRemove(path) })}
      />
    );
  }
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">条件グループ</span>
        <NativeSelect
          value={node.combinator}
          aria-label="条件の組み合わせ"
          className="w-32"
          onChange={(event) =>
            onReplace(path, { ...node, combinator: event.target.value as "and" | "or" })
          }
        >
          <NativeSelectOption value="and">すべて満たす</NativeSelectOption>
          <NativeSelectOption value="or">いずれか満たす</NativeSelectOption>
        </NativeSelect>
        {path.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="グループを削除"
            onClick={() => onRemove(path)}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {node.children.map((child, index) => (
          <FilterNodeEditor
            key={`${path.join("-")}-${index}`}
            node={child}
            path={[...path, index]}
            catalog={catalog}
            onReplace={onReplace}
            onRemove={onRemove}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onReplace(path, { ...node, children: [...node.children, defaultCondition(catalog)] })
          }
        >
          <Plus data-icon="inline-start" />
          条件を追加
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onReplace(path, {
              ...node,
              children: [
                ...node.children,
                { kind: "group", combinator: "and", children: [defaultCondition(catalog)] },
              ],
            })
          }
        >
          <Plus data-icon="inline-start" />
          グループを追加
        </Button>
      </div>
    </div>
  );
}

function ConditionEditor({
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
    (option) =>
      condition.field !== "custom_field" ||
      !customField?.dataType ||
      customFieldOperatorAllowed(customField.dataType, option.operator),
  );
  const resourceOptions = optionsForField(condition.field, catalog);
  const needsValue = segmentConditionNeedsValue(condition.field, condition.operator);

  function changeField(field: SegmentField): void {
    onChange(defaultConditionForField(field, catalog));
  }

  function changeOperator(operator: SegmentOperator): void {
    onChange(
      createSegmentCondition(
        condition.field,
        operator,
        rawConditionValue(condition),
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
        onChange={(event) => changeField(event.target.value as SegmentField)}
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
      <ConditionValueEditor
        condition={condition}
        catalog={catalog}
        options={resourceOptions}
        customField={customField}
        needsValue={needsValue}
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

function ConditionValueEditor({
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
            onChange(
              createSegmentCondition(
                condition.field,
                condition.field === "custom_field" && selected?.dataType
                  ? normalizeCustomFieldOperator(selected.dataType, condition.operator)
                  : normalizeSegmentOperator(condition.field, condition.operator),
                defaultRawValue(selected?.dataType),
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
            value={rawConditionValue(condition)}
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
      value={rawConditionValue(condition)}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

export function defaultSegmentFilter(catalog: SegmentGenerationCatalog): SegmentFilter {
  return { kind: "group", combinator: "and", children: [defaultCondition(catalog)] };
}

function defaultCondition(catalog: SegmentGenerationCatalog): SegmentCondition {
  return defaultConditionForField("status", catalog);
}

function defaultConditionForField(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
): SegmentCondition {
  const options = optionsForField(field, catalog);
  const keyOptions = field === "event" ? catalog.events : catalog.customFields;
  const keyOption = keyOptions[0];
  const operator = normalizeSegmentOperator(field, field === "event" ? "exists" : "eq");
  const rawValue =
    field === "status"
      ? "active"
      : field === "stage"
        ? (catalog.stages[0] ?? "lead")
        : (options[0]?.value ??
          defaultRawValue(keyOption?.dataType ?? getSegmentFieldDefinition(field).valueType));
  return createSegmentCondition(field, operator, rawValue, keyOption?.value, keyOption?.dataType);
}

function optionsForField(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
): SegmentResourceOption[] {
  switch (field) {
    case "tag":
      return catalog.tags;
    case "segment":
      return catalog.staticSegments;
    case "company":
      return catalog.companies;
    case "subscription":
      return catalog.subscriptionTopics;
    default:
      return [];
  }
}

function defaultRawValue(valueType?: string): string {
  if (valueType === "number") return "0";
  if (valueType === "boolean") return "false";
  if (valueType === "date") return new Date().toISOString().slice(0, 16);
  return "value";
}

function rawConditionValue(condition: SegmentCondition): string {
  return Array.isArray(condition.value)
    ? condition.value.join(", ")
    : String(condition.value ?? "");
}

function replaceNode(root: SegmentFilter, path: number[], next: SegmentFilter): SegmentFilter {
  if (path.length === 0) return next;
  if (root.kind !== "group") return root;
  const [index, ...rest] = path;
  if (index === undefined || !root.children[index]) return root;
  return {
    ...root,
    children: root.children.map((child, childIndex) =>
      childIndex === index ? replaceNode(child, rest, next) : child,
    ),
  };
}

function removeNode(root: SegmentFilter, path: number[]): SegmentFilter {
  if (path.length === 0 || root.kind !== "group") return root;
  const [index, ...rest] = path;
  if (index === undefined) return root;
  if (rest.length === 0) {
    const children = root.children.filter((_, childIndex) => childIndex !== index);
    return {
      ...root,
      children: children.length > 0 ? children : [defaultConditionForField("status", emptyCatalog)],
    };
  }
  return {
    ...root,
    children: root.children.map((child, childIndex) =>
      childIndex === index ? removeNode(child, rest) : child,
    ),
  };
}

const emptyCatalog: SegmentGenerationCatalog = {
  tags: [],
  staticSegments: [],
  companies: [],
  subscriptionTopics: [],
  events: [],
  customFields: [],
  stages: [],
};

function customFieldOperatorAllowed(dataType: string, operator: SegmentOperator): boolean {
  if (
    operator === "eq" ||
    operator === "neq" ||
    operator === "exists" ||
    operator === "not_exists"
  ) {
    return true;
  }
  if (dataType === "number" || dataType === "date") {
    return (
      operator === "in" ||
      operator === "gt" ||
      operator === "gte" ||
      operator === "lt" ||
      operator === "lte"
    );
  }
  if (dataType === "text") {
    return operator === "in" || operator === "contains" || operator === "starts_with";
  }
  return dataType === "select" && operator === "in";
}

function normalizeCustomFieldOperator(
  dataType: string,
  operator: SegmentOperator,
): SegmentOperator {
  return customFieldOperatorAllowed(dataType, operator) ? operator : "eq";
}
