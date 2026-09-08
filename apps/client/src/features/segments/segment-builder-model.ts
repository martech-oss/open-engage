import {
  getSegmentFieldDefinition,
  type SegmentCondition,
  type SegmentField,
  type SegmentFilter,
  type SegmentGenerationCatalog,
  type SegmentOperator,
  type SegmentResourceOption,
} from "@openengage/core/segments";

import { createSegmentCondition, normalizeSegmentOperator } from "./segment-fields";

export interface SegmentDefaultValues {
  dateTimeLocal: string;
}

export function createDefaultSegmentFilter(
  catalog: SegmentGenerationCatalog,
  defaults: SegmentDefaultValues,
): SegmentFilter {
  return {
    kind: "group",
    combinator: "and",
    children: [createDefaultSegmentCondition("status", catalog, defaults)],
  };
}

export function createDefaultSegmentCondition(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
  defaults: SegmentDefaultValues,
): SegmentCondition {
  const options = segmentOptionsForField(field, catalog);
  const keyOptions =
    field === "event"
      ? catalog.events
      : field === "custom_field"
        ? catalog.customFields
        : field === "category_score"
          ? (catalog.categories ?? [])
          : field === "company_custom_field"
            ? (catalog.companyCustomFields ?? [])
            : [];
  const keyOption = keyOptions[0];
  const operator = normalizeSegmentOperator(field, field === "event" ? "exists" : "eq");
  const rawValue = defaultRawValueForField(field, catalog, options, keyOption, defaults);
  return createSegmentCondition(field, operator, rawValue, keyOption?.value, keyOption?.dataType);
}

export function replaceSegmentNode(
  root: SegmentFilter,
  path: readonly number[],
  next: SegmentFilter,
): SegmentFilter {
  if (path.length === 0) return next;
  if (root.kind !== "group") return root;
  const [index, ...rest] = path;
  if (index === undefined || !root.children[index]) return root;
  const child = root.children[index];
  const replacement = replaceSegmentNode(child, rest, next);
  if (replacement === child) return root;
  return {
    ...root,
    children: root.children.map((child, childIndex) =>
      childIndex === index ? replacement : child,
    ),
  };
}

export function removeSegmentNode(
  root: SegmentFilter,
  path: readonly number[],
  catalog: SegmentGenerationCatalog,
  defaults: SegmentDefaultValues,
): SegmentFilter {
  if (path.length === 0 || root.kind !== "group") return root;
  const [index, ...rest] = path;
  if (index === undefined || !root.children[index]) return root;
  if (rest.length === 0) {
    const children = root.children.filter((_, childIndex) => childIndex !== index);
    return {
      ...root,
      children:
        children.length > 0
          ? children
          : [createDefaultSegmentCondition("status", catalog, defaults)],
    };
  }
  const child = root.children[index];
  const nextChild = removeSegmentNode(child, rest, catalog, defaults);
  if (nextChild === child) return root;
  return {
    ...root,
    children: root.children.map((current, childIndex) =>
      childIndex === index ? nextChild : current,
    ),
  };
}

export function appendSegmentCondition(
  root: SegmentFilter,
  path: readonly number[],
  catalog: SegmentGenerationCatalog,
  defaults: SegmentDefaultValues,
): SegmentFilter {
  return appendSegmentChild(root, path, createDefaultSegmentCondition("status", catalog, defaults));
}

export function appendSegmentGroup(
  root: SegmentFilter,
  path: readonly number[],
  catalog: SegmentGenerationCatalog,
  defaults: SegmentDefaultValues,
): SegmentFilter {
  return appendSegmentChild(root, path, {
    kind: "group",
    combinator: "and",
    children: [createDefaultSegmentCondition("status", catalog, defaults)],
  });
}

function appendSegmentChild(
  root: SegmentFilter,
  path: readonly number[],
  child: SegmentFilter,
): SegmentFilter {
  const target = segmentNodeAtPath(root, path);
  if (!target || target.kind !== "group") return root;
  return replaceSegmentNode(root, path, { ...target, children: [...target.children, child] });
}

function segmentNodeAtPath(root: SegmentFilter, path: readonly number[]): SegmentFilter | null {
  let current = root;
  for (const index of path) {
    if (current.kind !== "group" || !current.children[index]) return null;
    current = current.children[index];
  }
  return current;
}

export function segmentOptionsForField(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
): SegmentResourceOption[] {
  switch (field) {
    case "status":
      return ["active", "anonymous"].map((value) => ({ id: value, name: value, value }));
    case "stage":
      return catalog.stages.map((value) => ({ id: value, name: value, value }));
    case "deal_stage_id":
      return catalog.dealStages ?? [];
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

function defaultRawValueForField(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
  options: SegmentResourceOption[],
  keyOption: SegmentResourceOption | undefined,
  defaults: SegmentDefaultValues,
): string {
  if (field === "status") return "active";
  if (field === "stage") return catalog.stages[0] ?? "lead";
  return (
    options[0]?.value ??
    defaultSegmentRawValue(
      keyOption?.dataType ?? getSegmentFieldDefinition(field).valueType,
      defaults,
    )
  );
}

export function defaultSegmentRawValue(
  valueType: string | undefined,
  defaults: SegmentDefaultValues,
): string {
  if (valueType === "number") return "0";
  if (valueType === "boolean") return "false";
  if (valueType === "date") return defaults.dateTimeLocal;
  return "value";
}

export function rawSegmentConditionValue(condition: SegmentCondition): string {
  return Array.isArray(condition.value)
    ? condition.value.join(", ")
    : String(condition.value ?? "");
}

export function customFieldOperatorAllowed(dataType: string, operator: SegmentOperator): boolean {
  if (["eq", "neq", "exists", "not_exists"].includes(operator)) return true;
  if (dataType === "number" || dataType === "date") {
    return ["in", "gt", "gte", "lt", "lte"].includes(operator);
  }
  if (dataType === "text") return ["in", "contains", "starts_with"].includes(operator);
  return dataType === "select" && operator === "in";
}

export function normalizeCustomFieldOperator(
  dataType: string,
  operator: SegmentOperator,
): SegmentOperator {
  return customFieldOperatorAllowed(dataType, operator) ? operator : "eq";
}

export function mapSegmentDateValues(
  filter: SegmentFilter,
  catalog: SegmentGenerationCatalog,
  map: (value: string) => string,
): SegmentFilter {
  if (filter.kind === "group") {
    const children = filter.children.map((child) => mapSegmentDateValues(child, catalog, map));
    return children.every((child, index) => child === filter.children[index])
      ? filter
      : { ...filter, children };
  }
  const isDate =
    filter.field === "created_at" ||
    filter.field === "updated_at" ||
    (filter.field === "custom_field" &&
      catalog.customFields.some(
        (field) => field.value === filter.key && field.dataType === "date",
      ));
  if (!isDate) return filter;
  const value = Array.isArray(filter.value)
    ? filter.value.map((item) => (typeof item === "string" ? map(item) : item))
    : typeof filter.value === "string"
      ? map(filter.value)
      : filter.value;
  return { ...filter, value };
}
