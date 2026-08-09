import * as z from "zod";

import {
  getSegmentFieldDefinition,
  isSegmentOperatorAllowed,
  segmentFieldValues,
  segmentOperatorValues,
} from "./fields";

const segmentFieldSchema = z.enum(segmentFieldValues);
export const segmentOperatorSchema = z.enum(segmentOperatorValues);
export const segmentValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
  z.null(),
]);

export const segmentConditionSchema = z
  .object({
    kind: z.literal("condition"),
    field: segmentFieldSchema,
    key: z.string().max(191).optional(),
    operator: segmentOperatorSchema,
    value: segmentValueSchema,
  })
  .superRefine((condition, context) => {
    if (!isSegmentOperatorAllowed(condition.field, condition.operator)) {
      context.addIssue({
        code: "custom",
        path: ["operator"],
        message: `${condition.operator} is not supported for ${condition.field}`,
      });
    }

    const definition = getSegmentFieldDefinition(condition.field);
    if (definition.keyRequirement === "required" && !condition.key?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: `${condition.field} requires key`,
      });
    }

    if (
      condition.field === "custom_field" &&
      condition.key &&
      !/^[A-Za-z0-9_.-]{1,191}$/.test(condition.key)
    ) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: "custom_field key contains unsupported JSON-path characters",
      });
    }

    validateConditionValue(condition, definition.valueType, context);
  });
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export interface SegmentGroup {
  kind: "group";
  combinator: "and" | "or";
  children: SegmentFilter[];
}

export type SegmentFilter = SegmentCondition | SegmentGroup;

export const segmentFilterSchema: z.ZodType<SegmentFilter> = z.lazy(() =>
  z.union([
    segmentConditionSchema,
    z.object({
      kind: z.literal("group"),
      combinator: z.enum(["and", "or"]),
      children: z.array(segmentFilterSchema).min(1).max(25),
    }),
  ]),
);

export const segmentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  kind: z.enum(["static", "dynamic"]),
  filterAst: segmentFilterSchema.nullable(),
  membershipSource: z.string().nullable(),
  filterVersion: z.number().int().positive(),
  memberCount: z.number().int().nonnegative(),
  evaluatedAt: z.string().nullable(),
  evaluationStatus: z.enum(["pending", "running", "ready", "failed"]),
  evaluationError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SegmentRow = z.infer<typeof segmentRowSchema>;

function validateConditionValue(
  condition: {
    field: (typeof segmentFieldValues)[number];
    operator: z.infer<typeof segmentOperatorSchema>;
    value: z.infer<typeof segmentValueSchema>;
  },
  valueType: "text" | "number" | "date" | "relation" | "custom",
  context: z.RefinementCtx,
): void {
  const { field, operator, value } = condition;
  const unary = operator === "exists" || operator === "not_exists";

  if (field === "event") {
    if (value !== null) addValueIssue(context, "event conditions require value: null");
    return;
  }

  if (valueType === "relation") {
    if (typeof value !== "string" || !value.trim()) {
      addValueIssue(context, `${field} requires a non-empty resource value`);
    }
    return;
  }

  if (unary) {
    if (value !== null) addValueIssue(context, `${operator} requires value: null`);
    return;
  }

  if (operator === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      addValueIssue(context, "in requires a non-empty array");
      return;
    }
    if (valueType === "number" && value.some((item) => typeof item !== "number")) {
      addValueIssue(context, `${field} requires numeric values`);
    }
    if (
      (valueType === "text" || valueType === "date") &&
      value.some((item) => typeof item !== "string")
    ) {
      addValueIssue(context, `${field} requires string values`);
    }
    if (valueType === "date" && value.some((item) => !isIsoDateTime(item))) {
      addValueIssue(context, `${field} requires ISO date/time values`);
    }
    return;
  }

  if (valueType === "number" && typeof value !== "number") {
    addValueIssue(context, `${field} requires a numeric value`);
  }
  if (valueType === "text" && typeof value !== "string") {
    addValueIssue(context, `${field} requires a string value`);
  }
  if (valueType === "date" && (typeof value !== "string" || !isIsoDateTime(value))) {
    addValueIssue(context, `${field} requires an ISO date/time value`);
  }
}

function addValueIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", path: ["value"], message });
}

function isIsoDateTime(value: string | number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}
