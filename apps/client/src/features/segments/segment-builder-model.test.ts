import { describe, expect, it } from "vitest";

import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import {
  appendSegmentCondition,
  appendSegmentGroup,
  createDefaultSegmentCondition,
  createDefaultSegmentFilter,
  defaultSegmentRawValue,
  normalizeCustomFieldOperator,
  mapSegmentDateValues,
  removeSegmentNode,
  replaceSegmentNode,
} from "./segment-builder-model";

const defaults = { dateTimeLocal: "2026-01-02T10:30" };

const catalog: SegmentGenerationCatalog = {
  tags: [{ id: "tag-1", name: "顧客", value: "tag-1" }],
  staticSegments: [],
  companies: [],
  subscriptionTopics: [],
  events: [{ id: "event-1", name: "購入", value: "purchased" }],
  customFields: [{ id: "field-1", name: "利用席数", value: "seat_count", dataType: "number" }],
  stages: ["subscriber", "lead"],
};

const emptyCatalog: SegmentGenerationCatalog = {
  tags: [],
  staticSegments: [],
  companies: [],
  subscriptionTopics: [],
  events: [],
  customFields: [],
  stages: [],
};

const emailCondition = {
  kind: "condition",
  field: "email",
  operator: "contains",
  value: "example.jp",
} as const;

describe("segment builder model defaults", () => {
  it("creates a literal status filter without sharing mutable children", () => {
    const first = createDefaultSegmentFilter(catalog, defaults);
    const second = createDefaultSegmentFilter(catalog, defaults);

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
    expect(createDefaultSegmentCondition("tag", catalog, defaults)).toEqual({
      kind: "condition",
      field: "tag",
      operator: "eq",
      value: "tag-1",
    });
    expect(createDefaultSegmentCondition("event", catalog, defaults)).toEqual({
      kind: "condition",
      field: "event",
      key: "purchased",
      operator: "exists",
      value: null,
    });
    expect(createDefaultSegmentCondition("custom_field", catalog, defaults)).toEqual({
      kind: "condition",
      field: "custom_field",
      key: "seat_count",
      operator: "eq",
      value: 0,
    });
  });

  it("uses the exact injected date and stays deterministic for identical inputs", () => {
    const first = createDefaultSegmentCondition("created_at", catalog, defaults);
    const second = createDefaultSegmentCondition("created_at", catalog, defaults);

    expect(first).toEqual({
      kind: "condition",
      field: "created_at",
      operator: "eq",
      value: "2026-01-02T10:30",
    });
    expect(second).toEqual({
      kind: "condition",
      field: "created_at",
      operator: "eq",
      value: "2026-01-02T10:30",
    });
  });

  it("uses the literal boolean default for a boolean custom field", () => {
    expect(
      createDefaultSegmentCondition(
        "custom_field",
        {
          ...emptyCatalog,
          customFields: [
            { id: "field-boolean", name: "有効", value: "enabled", dataType: "boolean" },
          ],
        },
        defaults,
      ),
    ).toEqual({
      kind: "condition",
      field: "custom_field",
      key: "enabled",
      operator: "eq",
      value: false,
    });
    expect(defaultSegmentRawValue("boolean", defaults)).toBe("false");
  });

  it("uses literal fallback values when catalog options are empty", () => {
    expect(createDefaultSegmentCondition("stage", emptyCatalog, defaults)).toEqual({
      kind: "condition",
      field: "stage",
      operator: "eq",
      value: "lead",
    });
    expect(createDefaultSegmentCondition("tag", emptyCatalog, defaults)).toEqual({
      kind: "condition",
      field: "tag",
      operator: "eq",
      value: "value",
    });
    expect(createDefaultSegmentCondition("event", emptyCatalog, defaults)).toEqual({
      kind: "condition",
      field: "event",
      operator: "exists",
      value: null,
    });
    expect(createDefaultSegmentCondition("custom_field", emptyCatalog, defaults)).toEqual({
      kind: "condition",
      field: "custom_field",
      operator: "eq",
      value: "value",
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
    expect(removeSegmentNode(root, [1, 0], catalog, defaults)).toEqual({
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
    expect(removeSegmentNode(root, [], catalog, defaults)).toBe(root);
    expect(removeSegmentNode(root, [4], catalog, defaults)).toBe(root);
  });

  it("appends literal condition and group defaults without mutating the source", () => {
    const conditionResult = appendSegmentCondition(root, [], catalog, defaults);
    const groupResult = appendSegmentGroup(root, [], catalog, defaults);

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

  it("appends literal defaults inside a nested group", () => {
    expect(appendSegmentCondition(root, [1], catalog, defaults)).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        emailCondition,
        {
          kind: "group",
          combinator: "or",
          children: [
            { kind: "condition", field: "score", operator: "gte", value: 10 },
            { kind: "condition", field: "status", operator: "eq", value: "active" },
          ],
        },
      ],
    });
    expect(appendSegmentGroup(root, [1], catalog, defaults)).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        emailCondition,
        {
          kind: "group",
          combinator: "or",
          children: [
            { kind: "condition", field: "score", operator: "gte", value: 10 },
            {
              kind: "group",
              combinator: "and",
              children: [{ kind: "condition", field: "status", operator: "eq", value: "active" }],
            },
          ],
        },
      ],
    });
  });

  it("preserves identity when append paths are invalid or target a condition", () => {
    expect(appendSegmentCondition(root, [9], catalog, defaults)).toBe(root);
    expect(appendSegmentGroup(root, [9, 0], catalog, defaults)).toBe(root);
    expect(appendSegmentCondition(root, [0], catalog, defaults)).toBe(root);
    expect(appendSegmentGroup(root, [0], catalog, defaults)).toBe(root);
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

describe("segment date value mapping", () => {
  it("maps built-in and workspace date custom-field values through nested groups", () => {
    const filter: SegmentFilter = {
      kind: "group",
      combinator: "and",
      children: [
        {
          kind: "condition",
          field: "created_at",
          operator: "gte",
          value: "2026-08-22T17:15",
        },
        {
          kind: "condition",
          field: "custom_field",
          key: "renewal_at",
          operator: "in",
          value: ["2026-11-01T01:30", "2026-11-02T01:30"],
        },
        {
          kind: "condition",
          field: "custom_field",
          key: "seat_count",
          operator: "gte",
          value: 3,
        },
      ],
    };
    const dateCatalog: SegmentGenerationCatalog = {
      ...catalog,
      customFields: [
        ...catalog.customFields,
        { id: "field-date", name: "更新日", value: "renewal_at", dataType: "date" },
      ],
    };

    expect(mapSegmentDateValues(filter, dateCatalog, (value) => `utc:${value}`)).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        {
          kind: "condition",
          field: "created_at",
          operator: "gte",
          value: "utc:2026-08-22T17:15",
        },
        {
          kind: "condition",
          field: "custom_field",
          key: "renewal_at",
          operator: "in",
          value: ["utc:2026-11-01T01:30", "utc:2026-11-02T01:30"],
        },
        {
          kind: "condition",
          field: "custom_field",
          key: "seat_count",
          operator: "gte",
          value: 3,
        },
      ],
    });
  });
});

it("converts event and company custom dates together with program dates", () => {
  const dateCatalog: SegmentGenerationCatalog = {
    ...catalog,
    companyCustomFields: [{ id: "renewal", name: "Renewal", value: "renewal", dataType: "date" }],
  };
  const filter: SegmentFilter = {
    kind: "group",
    combinator: "and",
    children: [
      { kind: "condition", field: "event_occurred_at", operator: "gte", value: "2026-09-08T09:00" },
      {
        kind: "condition",
        field: "company_custom_field",
        key: "renewal",
        operator: "lt",
        value: "2026-10-01T09:00",
      },
      { kind: "condition", field: "project_joined_at", operator: "gte", value: "2026-09-01T09:00" },
      {
        kind: "condition",
        field: "project_success_at",
        operator: "lte",
        value: "2026-09-30T09:00",
      },
    ],
  };
  expect(mapSegmentDateValues(filter, dateCatalog, (value) => `${value}+09:00`)).toEqual({
    ...filter,
    children: [
      {
        kind: "condition",
        field: "event_occurred_at",
        operator: "gte",
        value: "2026-09-08T09:00+09:00",
      },
      {
        kind: "condition",
        field: "company_custom_field",
        key: "renewal",
        operator: "lt",
        value: "2026-10-01T09:00+09:00",
      },
      {
        kind: "condition",
        field: "project_joined_at",
        operator: "gte",
        value: "2026-09-01T09:00+09:00",
      },
      {
        kind: "condition",
        field: "project_success_at",
        operator: "lte",
        value: "2026-09-30T09:00+09:00",
      },
    ],
  });
});
