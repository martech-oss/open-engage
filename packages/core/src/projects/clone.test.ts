import { describe, expect, it } from "vitest";

import { rewriteProjectCloneReferences } from "./clone";

const context = {
  ids: {
    "project-old": "project-new",
    "form-old": "form-new",
    "auto-old": "auto-new",
    "page-v1": "page-v2",
  },
  segmentSlugs: { customers: "customers-copy" },
  managedUrls: { "https://example.com/p/acme/offer": "https://example.com/p/acme/offer-copy" },
};

describe("project clone reference rewriting", () => {
  it("maps qualified internal program status versions to the new program's first publication", () => {
    const condition = {
      kind: "condition",
      field: "project_status",
      operator: "eq",
      value: "registered",
    };
    expect(
      rewriteProjectCloneReferences(
        [
          { ...condition, program: { projectId: "project-old", definitionVersion: 4 } },
          { ...condition, program: { projectId: "shared", definitionVersion: 4 } },
          condition,
        ],
        context,
      ),
    ).toEqual([
      { ...condition, program: { projectId: "project-new", definitionVersion: 1 } },
      { ...condition, program: { projectId: "shared", definitionVersion: 4 } },
      condition,
    ]);
  });
  it("rewrites Markdown destinations while preserving labels, code, and external URLs", () => {
    const url = "https://example.com/p/acme/offer";
    const input = [
      `[${url}](${url}?from=email#join "Offer")`,
      `[External](https://outside.example/p/acme/offer)`,
      `\`[Code](${url})\``,
      "```md",
      `[Code block](${url})`,
      "```",
      `[Reference]: ${url}?ref=1 "Offer"`,
      "[Offer][Reference]",
      `[Angle](<${url}>)`,
      `\\[Escaped](${url})`,
    ].join("\n");
    const expected = input
      .replace(`](${url}?from=email`, `](${url}-copy?from=email`)
      .replace(`]: ${url}?ref=1`, `]: ${url}-copy?ref=1`)
      .replace(`](<${url}>)`, `](<${url}-copy>)`);
    expect(rewriteProjectCloneReferences({ markdown: input }, context)).toEqual({
      markdown: expected,
    });
  });
  it("rewrites structural references and segment slugs without replacing matching display text", () => {
    expect(
      rewriteProjectCloneReferences(
        {
          projectId: "project-old",
          title: "project-old",
          value: "form-old",
          nested: [{ formId: "form-old", automationId: "auto-old", pageVersionId: "page-v1" }],
          condition: {
            kind: "condition",
            field: "segment",
            operator: "in",
            value: ["customers", "shared"],
          },
          tag: { kind: "condition", field: "tag", operator: "eq", value: "customers" },
        },
        context,
      ),
    ).toEqual({
      projectId: "project-new",
      title: "project-old",
      value: "form-old",
      nested: [{ formId: "form-new", automationId: "auto-new", pageVersionId: "page-v2" }],
      condition: {
        kind: "condition",
        field: "segment",
        operator: "in",
        value: ["customers-copy", "shared"],
      },
      tag: { kind: "condition", field: "tag", operator: "eq", value: "customers" },
    });
  });

  it("only rewrites recognized managed URLs, preserving query and fragment and external hosts", () => {
    expect(
      rewriteProjectCloneReferences(
        {
          href: "https://example.com/p/acme/offer?source=ad#join",
          destinationUrl: "https://external.test/p/acme/offer",
          html: '<a href="https://example.com/p/acme/offer">Offer</a><p>offer</p>',
        },
        context,
      ),
    ).toEqual({
      href: "https://example.com/p/acme/offer-copy?source=ad#join",
      destinationUrl: "https://external.test/p/acme/offer",
      html: '<a href="https://example.com/p/acme/offer-copy">Offer</a><p>offer</p>',
    });
  });
});
