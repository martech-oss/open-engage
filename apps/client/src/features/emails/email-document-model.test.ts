import { describe, expect, it } from "vitest";

import { defaultEmailDocumentV2, type EmailBlockV2 } from "@openengage/core/messaging";

import {
  createEmailBlock,
  createEmailImageBlock,
  reduceEmailDocument,
} from "./email-document-model";

describe("email block defaults", () => {
  it.each([
    ["markdown", { id: "block-1", type: "markdown", markdown: "本文を入力してください。" }],
    [
      "button",
      {
        id: "block-1",
        type: "button",
        label: "詳しく見る",
        href: "https://example.com",
        variant: "primary",
        align: "center",
      },
    ],
    ["divider", { id: "block-1", type: "divider" }],
    ["spacer", { id: "block-1", type: "spacer", height: 24 }],
  ] as const)("creates the literal %s block", (type, expected) => {
    expect(createEmailBlock(type, "block-1")).toEqual(expected);
  });

  it("creates an image block capped to the document content width", () => {
    expect(createEmailImageBlock({ id: "asset-1", name: "Hero" }, "image-1", 700)).toEqual({
      id: "image-1",
      type: "image",
      source: { kind: "asset", assetId: "asset-1" },
      alt: "Hero",
      width: 652,
      align: "center",
    });
  });
});

describe("email document block commands", () => {
  const first: EmailBlockV2 = { id: "first", type: "markdown", markdown: "First" };
  const second: EmailBlockV2 = { id: "second", type: "divider" };
  const document = { ...defaultEmailDocumentV2(), blocks: [first, second] };

  it("adds a block without mutating the source document", () => {
    const block: EmailBlockV2 = { id: "third", type: "spacer", height: 24 };

    expect(reduceEmailDocument(document, { type: "add", block })).toEqual({
      ...document,
      blocks: [first, second, block],
    });
    expect(document.blocks).toEqual([first, second]);
  });

  it("updates the addressed block and ignores an invalid index", () => {
    const block: EmailBlockV2 = { id: "second", type: "spacer", height: 40 };

    expect(reduceEmailDocument(document, { type: "update", index: 1, block })).toEqual({
      ...document,
      blocks: [first, block],
    });
    expect(reduceEmailDocument(document, { type: "update", index: 4, block })).toBe(document);
  });

  it("moves a block up or down and ignores document boundaries", () => {
    expect(reduceEmailDocument(document, { type: "move", index: 0, offset: 1 })).toEqual({
      ...document,
      blocks: [second, first],
    });
    expect(reduceEmailDocument(document, { type: "move", index: 0, offset: -1 })).toBe(document);
    expect(reduceEmailDocument(document, { type: "move", index: 1, offset: 1 })).toBe(document);
  });

  it("deletes a block but keeps the schema-required final block", () => {
    expect(reduceEmailDocument(document, { type: "delete", index: 0 })).toEqual({
      ...document,
      blocks: [second],
    });
    expect(
      reduceEmailDocument({ ...document, blocks: [first] }, { type: "delete", index: 0 }),
    ).toEqual({ ...document, blocks: [first] });
    expect(reduceEmailDocument(document, { type: "delete", index: 5 })).toBe(document);
  });
});
