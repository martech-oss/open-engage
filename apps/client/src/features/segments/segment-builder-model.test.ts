import { describe, expect, it } from "vitest";

import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import {
  appendSegmentCondition,
  appendSegmentGroup,
  createDefaultSegmentCondition,
  createDefaultSegmentFilter,
  normalizeCustomFieldOperator,
  removeSegmentNode,
  replaceSegmentNode,
} from "./segment-builder-model";

const catalog: SegmentGenerationCatalog = {
  tags: [{ id: "tag-1", name: "顧客", value: "tag-1" }],
  staticSegments: [],
  companies: [],
  subscriptionTopics: [],
  events: [{ id: "event-1", name: "購入", value: "purchased" }],
  customFields: [{ id: "field-1", name: "利用席数", value: "seat_count", dataType: "number" }],
  stages: ["subscriber", "lead"],
};

const emailCondition = {
  kind: "condition",
  field: "email",
  operator: "contains",
  value: "example.jp",
} as const;

describe("segment builder model defaults", () => {
  it("creates a literal status filter without sharing mutable children", () => {
    const first = createDefaultSegmentFilter(catalog);
    const second = createDefaultSegmentFilter(catalog);

    expect(first).toEqual({
      kind: "group",
      combinator: "and",
      children: [{ kind: "condition", field: "status", operator: "eq", value: "active" }],
    });
    expect(first).not.toBe(second);
    expect(first.kind === "group" && second.kind === "group" && first.children).not.toBe(
      second.kind === "group" ? second.children : undefined,
    );
  });

  it("uses catalog values and keyed defaults for relation, event, and custom fields", () => {
    expect(createDefaultSegmentCondition("tag", catalog)).toEqual({
      kind: "condition",
      field: "tag",
      operator: "eq",
      value: "tag-1",
    });
    expect(createDefaultSegmentCondition("event", catalog)).toEqual({
      kind: "condition",
      field: "event",
      key: "purchased",
      operator: "exists",
      value: null,
    });
    expect(createDefaultSegmentCondition("custom_field", catalog)).toEqual({
      kind: "condition",
      field: "custom_field",
      key: "seat_count",
      operator: "eq",
      value: 0,
    });
  });
});

describe("segment builder immutable AST commands", () => {
  const root: SegmentFilter = {
    kind: "group",
    combinator: "and",
    children: [
      emailCondition,
      {
        kind: "group",
        combinator: "or",
        children: [{ kind: "condition", field: "score", operator: "gte", value: 10 }],
      },
    ],
  };

  it("replaces a nested node without mutating the original tree", () => {
    const next = replaceSegmentNode(root, [1, 0], {
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 20,
    });

    expect(next).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        emailCondition,
        {
          kind: "group",
          combinator: "or",
          children: [{ kind: "condition", field: "score", operator: "gte", value: 20 }],
        },
      ],
    });
    expect(root).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        emailCondition,
        {
          kind: "group",
          combinator: "or",
          children: [{ kind: "condition", field: "score", operator: "gte", value: 10 }],
        },
      ],
    });
  });

  it("keeps the tree for an invalid replacement path", () => {
    expect(replaceSegmentNode(root, [9], emailCondition)).toBe(root);
    expect(replaceSegmentNode(root, [0, 0], emailCondition)).toBe(root);
  });

  it("removes a nested node and restores a valid default when a group becomes empty", () => {
    expect(removeSegmentNode(root, [1, 0], catalog)).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        emailCondition,
        {
          kind: "group",
          combinator: "or",
          children: [{ kind: "condition", field: "status", operator: "eq", value: "active" }],
        },
      ],
    });
  });

  it("does not remove the root or follow an invalid path", () => {
    expect(removeSegmentNode(root, [], catalog)).toBe(root);
    expect(removeSegmentNode(root, [4], catalog)).toBe(root);
  });

  it("appends literal condition and group defaults without mutating the source", () => {
    const conditionResult = appendSegmentCondition(root, [], catalog);
    const groupResult = appendSegmentGroup(root, [], catalog);

    expect(conditionResult.kind === "group" && conditionResult.children.at(-1)).toEqual({
      kind: "condition",
      field: "status",
      operator: "eq",
      value: "active",
    });
    expect(groupResult.kind === "group" && groupResult.children.at(-1)).toEqual({
      kind: "group",
      combinator: "and",
      children: [{ kind: "condition", field: "status", operator: "eq", value: "active" }],
    });
    expect(root.kind === "group" && root.children).toHaveLength(2);
  });
});

describe("custom field operator normalization", () => {
  it.each([
    ["number", "contains", "eq"],
    ["number", "gte", "gte"],
    ["date", "lt", "lt"],
    ["text", "contains", "contains"],
    ["text", "gt", "eq"],
    ["select", "in", "in"],
    ["boolean", "not_exists", "not_exists"],
  ] as const)("normalizes %s operator %s to %s", (dataType, operator, expected) => {
    expect(normalizeCustomFieldOperator(dataType, operator)).toBe(expected);
  });
});
