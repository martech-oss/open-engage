import {
  getSegmentFieldDefinition,
  isSegmentOperatorAllowed,
  type SegmentCondition,
  type SegmentField,
  type SegmentOperator,
} from "@openengage/core/segments";

export const segmentFieldOptions = [
  { field: "project_id", label: "施策ID（参加）" },
  { field: "project_status", label: "施策の参加 status" },
  { field: "project_success", label: "施策の成果（1=達成、0=未達成）" },
  { field: "project_joined_at", label: "施策の参加日時" },
  { field: "project_success_at", label: "施策の初回成果日時" },
  { field: "category_score", label: "カテゴリスコア" },
  { field: "lifecycle_stage", label: "ライフサイクル" },
  { field: "owner_user_id", label: "担当者ID" },
  { field: "company_name", label: "会社名" },
  { field: "company_custom_field", label: "会社カスタム項目" },
  { field: "deal_status", label: "商談ステータス" },
  { field: "deal_stage_id", label: "商談ステージID" },
  { field: "deal_owner_user_id", label: "商談担当者ID" },
  { field: "deal_value", label: "商談金額" },
  { field: "event_type", label: "イベント種別" },
  { field: "event_resource_type", label: "イベントリソース種別" },
  { field: "event_resource_id", label: "イベントリソースID" },
  { field: "event_occurred_at", label: "イベント日時" },
  { field: "event_age_minutes", label: "イベント経過分数" },
  { field: "event_property", label: "イベント属性" },
  { field: "email", label: "メールアドレス" },
  { field: "first_name", label: "名" },
  { field: "last_name", label: "姓" },
  { field: "phone", label: "電話番号" },
  { field: "external_id", label: "外部ID" },
  { field: "stage", label: "ステージ" },
  { field: "score", label: "スコア" },
  { field: "status", label: "ステータス" },
  { field: "created_at", label: "作成日時" },
  { field: "updated_at", label: "更新日時" },
  { field: "company", label: "会社" },
  { field: "tag", label: "タグ" },
  { field: "segment", label: "リスト" },
  { field: "subscription", label: "購読トピック" },
  { field: "event", label: "イベント" },
  { field: "custom_field", label: "カスタム項目" },
] as const satisfies readonly { field: SegmentField; label: string }[];

const segmentOperatorLabels = {
  eq: "等しい",
  neq: "等しくない",
  contains: "含む",
  starts_with: "前方一致",
  in: "いずれか",
  gt: "より大きい",
  gte: "以上",
  lt: "より小さい",
  lte: "以下",
  exists: "値がある",
  not_exists: "値がない",
} as const satisfies Record<SegmentOperator, string>;

export function getSegmentFieldLabel(field: SegmentField): string {
  return segmentFieldOptions.find((option) => option.field === field)?.label ?? field;
}

export function getSegmentOperatorLabel(operator: SegmentOperator): string {
  return segmentOperatorLabels[operator];
}

export function getSegmentOperatorOptions(
  field: SegmentField,
): Array<{ operator: SegmentOperator; label: string }> {
  return getSegmentFieldDefinition(field).operators.map((operator) => ({
    operator,
    label: segmentOperatorLabels[operator],
  }));
}

export function normalizeSegmentOperator(
  field: SegmentField,
  operator: SegmentOperator,
): SegmentOperator {
  if (isSegmentOperatorAllowed(field, operator)) return operator;
  const [fallback] = getSegmentFieldDefinition(field).operators;
  if (!fallback) throw new Error(`Segment field has no operators: ${field}`);
  return fallback;
}

export function segmentConditionNeedsValue(
  field: SegmentField,
  operator: SegmentOperator,
): boolean {
  const definition = getSegmentFieldDefinition(field);
  return (
    (definition.valueType === "relation" && field !== "event") ||
    (operator !== "exists" && operator !== "not_exists")
  );
}

export function createSegmentCondition(
  field: SegmentField,
  operator: SegmentOperator,
  rawValue: string,
  key?: string,
  customValueType?: "text" | "number" | "boolean" | "date" | "select",
): SegmentCondition {
  if (!isSegmentOperatorAllowed(field, operator)) {
    throw new Error(`${operator} is not supported for ${field}`);
  }

  const definition = getSegmentFieldDefinition(field);
  const value =
    field === "event"
      ? null
      : segmentConditionNeedsValue(field, operator)
        ? parseSegmentValue(
            definition.valueType === "custom" ? (customValueType ?? "text") : definition.valueType,
            operator,
            rawValue,
          )
        : null;

  return {
    kind: "condition",
    field,
    ...(definition.keyRequirement === "required" && key ? { key } : {}),
    operator,
    value,
  };
}

function parseSegmentValue(
  valueType: ReturnType<typeof getSegmentFieldDefinition>["valueType"] | "boolean" | "select",
  operator: SegmentOperator,
  rawValue: string,
): SegmentCondition["value"] {
  const value = rawValue.trim();
  if (operator === "in") {
    const values = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return valueType === "number" ? values.map(parseFiniteNumber) : values;
  }
  if (valueType === "number") return parseFiniteNumber(value);
  if (valueType === "boolean") return value === "true";
  return value;
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("数値を入力してください");
  return parsed;
}
