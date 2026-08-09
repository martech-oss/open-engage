import {
  getSegmentFieldDefinition,
  isSegmentOperatorAllowed,
  type SegmentCondition,
  type SegmentField,
  type SegmentOperator,
} from "@openengage/core/segments";

export const segmentFieldOptions = [
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
  { field: "segment", label: "静的セグメント" },
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
    ...((field === "event" || field === "custom_field") && key ? { key } : {}),
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
