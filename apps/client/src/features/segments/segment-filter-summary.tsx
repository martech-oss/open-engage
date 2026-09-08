import type { ReactNode } from "react";

import {
  getSegmentFieldLabel,
  getSegmentOperatorLabel,
  segmentConditionNeedsValue,
} from "@/features/segments/segment-fields";
import type {
  SegmentCondition,
  SegmentField,
  SegmentFilter,
  SegmentGenerationCatalog,
  SegmentResourceOption,
} from "@openengage/core/segments";

export function SegmentFilterSummary({
  filter,
  catalog,
}: {
  filter: SegmentFilter;
  catalog: SegmentGenerationCatalog;
}): ReactNode {
  return <FilterNode filter={filter} catalog={catalog} />;
}

function FilterNode({
  filter,
  catalog,
}: {
  filter: SegmentFilter;
  catalog: SegmentGenerationCatalog;
}): ReactNode {
  if (filter.kind === "condition") {
    return (
      <div className="rounded-md border bg-background px-3 py-2 text-sm">
        {formatCondition(filter, catalog)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
      <span className="text-sm font-medium">
        {filter.negated ? "一致なし · " : ""}
        {filter.relation ? `同じ ${filter.relation} · ` : ""}
        {filter.minimumCount ? `${filter.minimumCount}件以上 · ` : ""}
        {filter.combinator === "and" ? "すべて満たす" : "いずれか満たす"}
      </span>
      {filter.children.map((child, index) => (
        <FilterNode key={index} filter={child} catalog={catalog} />
      ))}
    </div>
  );
}

function formatCondition(condition: SegmentCondition, catalog: SegmentGenerationCatalog): string {
  const parts = [getSegmentFieldLabel(condition.field)];
  if (condition.key) {
    const customField =
      condition.field === "custom_field"
        ? catalog.customFields.find((option) => option.value === condition.key)
        : undefined;
    const event = catalog.events.find((option) => option.value === condition.key);
    parts.push(customField?.name ?? event?.name ?? condition.key);
  }
  parts.push(getSegmentOperatorLabel(condition.operator));
  if (segmentConditionNeedsValue(condition.field, condition.operator)) {
    const formatted = formatConditionValue(condition, catalog);
    if (formatted) parts.push(formatted);
  }
  return parts.join(" ");
}

function formatConditionValue(
  condition: SegmentCondition,
  catalog: SegmentGenerationCatalog,
): string {
  const { value } = condition;
  if (value === null || value === undefined) return "";
  const options = catalogOptionsForField(condition.field, catalog);
  if (Array.isArray(value)) {
    return value.map((item) => resolveOptionName(item, options)).join("、");
  }
  return resolveOptionName(value, options);
}

function resolveOptionName(
  value: string | number | boolean,
  options: SegmentResourceOption[],
): string {
  const raw = String(value);
  const match = options.find((option) => option.id === raw || option.value === raw);
  return match?.name ?? raw;
}

function catalogOptionsForField(
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
