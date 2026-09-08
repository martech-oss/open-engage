import { describe, expect, it } from "vitest";

import { segmentFieldDefinitions, segmentOperatorValues } from "./fields";
import { segmentConditionSchema } from "./schema";

describe("segment condition schema", () => {
  it("defines every supported segment field exactly once", () => {
    const fields = segmentFieldDefinitions.map((definition) => definition.field);

    expect(fields).toHaveLength(37);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toEqual(
      expect.arrayContaining([
        "project_id",
        "project_status",
        "project_success",
        "project_joined_at",
        "project_success_at",
        "email",
        "score",
        "tag",
        "segment",
        "company",
        "subscription",
        "event",
        "custom_field",
      ]),
    );
  });

  it("accepts operators supported by the field value type", () => {
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "email",
        operator: "contains",
        value: "@example.com",
      }).success,
    ).toBe(true);
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "score",
        operator: "gte",
        value: 10,
      }).success,
    ).toBe(true);
  });

  it.each(segmentFieldDefinitions)(
    "enforces the declared operator set for $field",
    (definition) => {
      for (const operator of segmentOperatorValues) {
        const unary = operator === "exists" || operator === "not_exists";
        const relation = definition.valueType === "relation" && definition.field !== "event";
        const comparableValue = definition.valueType === "number" ? 10 : "2026-08-09T00:00:00Z";
        const value = relation
          ? "resource"
          : definition.field === "event" || unary
            ? null
            : operator === "in"
              ? [comparableValue]
              : definition.valueType === "date" || definition.valueType === "number"
                ? comparableValue
                : "value";
        const result = segmentConditionSchema.safeParse({
          kind: "condition",
          field: definition.field,
          ...(definition.keyRequirement === "required" ? { key: "example.key" } : {}),
          operator,
          value,
        });

        expect(result.success, `${definition.field}:${operator}`).toBe(
          (definition.operators as readonly string[]).includes(operator),
        );
      }
    },
  );

  it("rejects operators that do not apply to a field", () => {
    const numericResult = segmentConditionSchema.safeParse({
      kind: "condition",
      field: "score",
      operator: "contains",
      value: "10",
    });
    const relationResult = segmentConditionSchema.safeParse({
      kind: "condition",
      field: "tag",
      operator: "gte",
      value: "customers",
    });

    expect(numericResult.success).toBe(false);
    expect(relationResult.success).toBe(false);
  });

  it.each(["event", "custom_field"] as const)("requires key for %s conditions", (field) => {
    const missingKey = segmentConditionSchema.safeParse({
      kind: "condition",
      field,
      operator: "eq",
      value: null,
    });
    const blankKey = segmentConditionSchema.safeParse({
      kind: "condition",
      field,
      key: "  ",
      operator: "eq",
      value: null,
    });
    const valid = segmentConditionSchema.safeParse({
      kind: "condition",
      field,
      key: "purchase.completed",
      operator: "eq",
      value: null,
    });

    expect(missingKey.success).toBe(false);
    expect(blankKey.success).toBe(false);
    expect(valid.success).toBe(true);
  });

  it("enforces field-specific values", () => {
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "score",
        operator: "gte",
        value: "10",
      }).success,
    ).toBe(false);
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "created_at",
        operator: "gte",
        value: "tomorrow",
      }).success,
    ).toBe(false);
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "email",
        operator: "in",
        value: [],
      }).success,
    ).toBe(false);
    expect(
      segmentConditionSchema.safeParse({
        kind: "condition",
        field: "custom_field",
        key: "bad[0]",
        operator: "exists",
        value: null,
      }).success,
    ).toBe(false);
  });
});
