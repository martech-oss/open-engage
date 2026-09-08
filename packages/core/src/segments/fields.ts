export const segmentOperatorValues = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
] as const;

export type SegmentOperator = (typeof segmentOperatorValues)[number];
export type SegmentValueType = "text" | "number" | "date" | "relation" | "custom";
export type SegmentKeyRequirement = "none" | "required";

export interface SegmentFieldDefinition {
  field: string;
  valueType: SegmentValueType;
  operators: readonly SegmentOperator[];
  keyRequirement: SegmentKeyRequirement;
}

const textOperators = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "in",
  "exists",
  "not_exists",
] as const satisfies readonly SegmentOperator[];
const comparableOperators = [
  "eq",
  "neq",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
] as const satisfies readonly SegmentOperator[];
const relationOperators = [
  "eq",
  "neq",
  "exists",
  "not_exists",
] as const satisfies readonly SegmentOperator[];

export const segmentFieldDefinitions = [
  { field: "project_id", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "project_status", valueType: "text", operators: textOperators, keyRequirement: "none" },
  {
    field: "project_success",
    valueType: "number",
    operators: ["eq", "neq"],
    keyRequirement: "none",
  },
  {
    field: "project_joined_at",
    valueType: "date",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  {
    field: "project_success_at",
    valueType: "date",
    operators: comparableOperators,
    keyRequirement: "none",
  },

  {
    field: "category_score",
    valueType: "number",
    operators: comparableOperators,
    keyRequirement: "required",
  },
  { field: "owner_user_id", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "lifecycle_stage", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "company_name", valueType: "text", operators: textOperators, keyRequirement: "none" },
  {
    field: "company_custom_field",
    valueType: "custom",
    operators: segmentOperatorValues,
    keyRequirement: "required",
  },
  { field: "deal_status", valueType: "text", operators: textOperators, keyRequirement: "none" },
  {
    field: "deal_stage_id",
    valueType: "text",
    operators: ["eq", "neq", "in", "exists", "not_exists"],
    keyRequirement: "none",
  },
  {
    field: "deal_owner_user_id",
    valueType: "text",
    operators: textOperators,
    keyRequirement: "none",
  },
  {
    field: "deal_value",
    valueType: "number",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  { field: "event_type", valueType: "text", operators: textOperators, keyRequirement: "none" },
  {
    field: "event_resource_type",
    valueType: "text",
    operators: textOperators,
    keyRequirement: "none",
  },
  {
    field: "event_resource_id",
    valueType: "text",
    operators: textOperators,
    keyRequirement: "none",
  },
  {
    field: "event_occurred_at",
    valueType: "date",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  {
    field: "event_age_minutes",
    valueType: "number",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  {
    field: "event_property",
    valueType: "custom",
    operators: segmentOperatorValues,
    keyRequirement: "required",
  },
  { field: "email", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "first_name", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "last_name", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "phone", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "external_id", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "stage", valueType: "text", operators: textOperators, keyRequirement: "none" },
  { field: "score", valueType: "number", operators: comparableOperators, keyRequirement: "none" },
  {
    // Thirds of a letter from the D baseline: `grade_points >= 3` is "C or better".
    field: "grade_points",
    valueType: "number",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  { field: "status", valueType: "text", operators: textOperators, keyRequirement: "none" },
  {
    field: "created_at",
    valueType: "date",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  {
    field: "updated_at",
    valueType: "date",
    operators: comparableOperators,
    keyRequirement: "none",
  },
  { field: "tag", valueType: "relation", operators: relationOperators, keyRequirement: "none" },
  {
    field: "segment",
    valueType: "relation",
    operators: relationOperators,
    keyRequirement: "none",
  },
  { field: "company", valueType: "relation", operators: relationOperators, keyRequirement: "none" },
  {
    field: "subscription",
    valueType: "relation",
    operators: relationOperators,
    keyRequirement: "none",
  },
  {
    field: "event",
    valueType: "relation",
    operators: relationOperators,
    keyRequirement: "required",
  },
  {
    field: "custom_field",
    valueType: "custom",
    operators: segmentOperatorValues,
    keyRequirement: "required",
  },
] as const satisfies readonly SegmentFieldDefinition[];

export type SegmentField = (typeof segmentFieldDefinitions)[number]["field"];
export type SegmentFieldMetadata = (typeof segmentFieldDefinitions)[number];

export const segmentFieldValues = segmentFieldDefinitions.map((definition) => definition.field) as [
  SegmentField,
  ...SegmentField[],
];

export function getSegmentFieldDefinition(field: SegmentField): SegmentFieldMetadata {
  const definition = segmentFieldDefinitions.find((candidate) => candidate.field === field);
  if (!definition) throw new Error(`Unsupported segment field: ${field}`);
  return definition;
}

export function isSegmentOperatorAllowed(field: SegmentField, operator: SegmentOperator): boolean {
  const definition = getSegmentFieldDefinition(field);
  return (definition.operators as readonly SegmentOperator[]).includes(operator);
}
