import { describe, expect, it } from "vitest";

import { segmentFilterSchema } from "./schema";
import { compileSegmentFilter } from "./segment";

describe("rich related segment predicates", () => {
  it("preserves one related-row boundary for exclusions", () => {
    const filter = segmentFilterSchema.parse({
      kind: "group",
      combinator: "and",
      relation: "deal",
      negated: true,
      children: [
        { kind: "condition", field: "deal_status", operator: "eq", value: "open" },
        { kind: "condition", field: "deal_value", operator: "gte", value: 1000 },
      ],
    });
    const compiled = compileSegmentFilter("ws", filter);
    expect(compiled.sql).toContain("NOT EXISTS");
    expect(compiled.sql.match(/FROM deals/g)).toHaveLength(1);
    expect(compiled.params).toEqual(["ws", "open", 1000]);
  });
  it("combines category score with a recent resource event and property", () => {
    const filter = segmentFilterSchema.parse({
      kind: "group",
      combinator: "and",
      children: [
        { kind: "condition", field: "category_score", key: "product", operator: "gte", value: 50 },
        {
          kind: "group",
          combinator: "and",
          relation: "event",
          minimumCount: 2,
          children: [
            { kind: "condition", field: "event_type", operator: "eq", value: "form_submitted" },
            { kind: "condition", field: "event_resource_id", operator: "eq", value: "form-1" },
            { kind: "condition", field: "event_age_minutes", operator: "lte", value: 60 },
            {
              kind: "condition",
              field: "event_property",
              key: "plan",
              operator: "eq",
              value: "pro",
            },
          ],
        },
      ],
    });
    const compiled = compileSegmentFilter("ws", filter);
    expect(compiled.sql).toContain("contact_category_scores");
    expect(compiled.sql).toContain("julianday('now')");
    expect(compiled.sql).toContain("COUNT(*)");
    expect(compiled.params).toContain("$.plan");
  });
  it("rejects unsafe related JSON keys", () => {
    expect(
      segmentFilterSchema.safeParse({
        kind: "condition",
        field: "company_custom_field",
        key: "x[0]",
        operator: "eq",
        value: 1,
      }).success,
    ).toBe(false);
  });
});

it("matches multiple related statuses with the in operator", () => {
  const filter = segmentFilterSchema.parse({
    kind: "condition",
    field: "deal_status",
    operator: "in",
    value: ["open", "won"],
  });
  expect(compileSegmentFilter("ws", filter).params).toEqual(["ws", "open", "won"]);
});

it("rejects a count without a related-row scope", () => {
  expect(
    segmentFilterSchema.safeParse({
      kind: "group",
      combinator: "and",
      minimumCount: 2,
      children: [{ kind: "condition", field: "score", operator: "gte", value: 10 }],
    }).success,
  ).toBe(false);
});

it("rejects ambiguous nested related scopes and arrays used as scalar custom values", () => {
  const scalar = { kind: "condition", field: "deal_status", operator: "eq", value: "open" };
  expect(
    segmentFilterSchema.safeParse({
      kind: "group",
      combinator: "and",
      relation: "deal",
      children: [
        scalar,
        { kind: "group", combinator: "and", relation: "deal", children: [scalar] },
      ],
    }).success,
  ).toBe(false);
  for (const field of ["event_property", "company_custom_field", "custom_field"]) {
    expect(
      segmentFilterSchema.safeParse({
        kind: "condition",
        field,
        key: "size",
        operator: "eq",
        value: [1, 2],
      }).success,
    ).toBe(false);
  }
  expect(
    segmentFilterSchema.safeParse({
      kind: "condition",
      field: "deal_stage_id",
      operator: "contains",
      value: "part",
    }).success,
  ).toBe(false);
});
