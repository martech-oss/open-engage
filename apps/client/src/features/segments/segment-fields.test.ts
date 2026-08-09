import { describe, expect, it } from "vitest";

import {
  createSegmentCondition,
  getSegmentOperatorOptions,
  normalizeSegmentOperator,
  segmentFieldOptions,
} from "@/features/segments/segment-fields";

describe("segment field editor", () => {
  it("exposes every field supported by the segment schema", () => {
    const fields = segmentFieldOptions.map((option) => option.field);

    expect(fields).toContain("email");
    expect(fields).toContain("tag");
    expect(fields).toContain("company");
    expect(fields).toContain("event");
    expect(fields).toContain("custom_field");
    expect(fields).toContain("segment");
    expect(fields).toContain("subscription");
  });

  it("resets an unsupported operator when the field changes", () => {
    expect(normalizeSegmentOperator("score", "contains")).toBe("eq");
    expect(normalizeSegmentOperator("email", "contains")).toBe("contains");
    expect(getSegmentOperatorOptions("score").map((option) => option.operator)).toContain("gte");
  });

  it("builds values that match the selected field and operator", () => {
    expect(createSegmentCondition("score", "gte", "10")).toEqual({
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 10,
    });
    expect(createSegmentCondition("email", "in", "one@example.com, two@example.com")).toEqual({
      kind: "condition",
      field: "email",
      operator: "in",
      value: ["one@example.com", "two@example.com"],
    });
    expect(createSegmentCondition("email", "not_exists", "")).toEqual({
      kind: "condition",
      field: "email",
      operator: "not_exists",
      value: null,
    });
  });
});
