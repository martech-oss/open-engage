import { describe, expect, it } from "vitest";

import {
  collectEmailAssetIds,
  collectMessageVariableKeys,
  defaultEmailDocumentV2,
  type EmailBlockV2,
  type EmailLeafBlockV2,
} from "./content.js";
import { type EmailGenerationResult, validateEmailGenerationResult } from "./generation.js";

const catalog = { publicImages: [{ id: "asset-1" }] };

function image(id: string, assetId: string): EmailLeafBlockV2 {
  return {
    id,
    type: "image",
    source: { kind: "asset", assetId },
    alt: "",
    width: 552,
    align: "center",
  };
}

function nested(child: EmailLeafBlockV2): EmailBlockV2[] {
  return [
    { id: "body", type: "markdown", markdown: "{{ message.plan }} をご案内します" },
    { id: "layout", type: "columns", columns: [{ blocks: [child] }, { blocks: [] }] },
  ];
}

function result(blocks: EmailBlockV2[], afterBlockId: string | null = null): EmailGenerationResult {
  return {
    proposal: {
      name: "Welcome",
      subject: "Welcome",
      content: { ...defaultEmailDocumentV2(), blocks },
    },
    summary: "Welcome email",
    assumptions: [],
    warnings: [],
    imageRequests: [{ requestId: "hero", afterBlockId, prompt: "A hero image", alt: "Hero" }],
  };
}

describe("email document references", () => {
  it("collects nested image assets and message variables", () => {
    const document = result(nested(image("hero", "asset-1"))).proposal.content;
    expect([...collectEmailAssetIds(document)]).toEqual(["asset-1"]);
    expect([...collectMessageVariableKeys(document)]).toEqual(["plan"]);
  });
});

describe("validateEmailGenerationResult", () => {
  it("accepts catalog images and top-level insertion points", () => {
    expect(
      validateEmailGenerationResult(result(nested(image("hero", "asset-1")), "layout"), catalog),
    ).toBeNull();
  });

  it("rejects duplicate block ids, including nested ones", () => {
    expect(validateEmailGenerationResult(result(nested(image("body", "asset-1"))), catalog)).toBe(
      "Duplicate block id: body",
    );
  });

  it("rejects nested images outside the catalog", () => {
    expect(validateEmailGenerationResult(result(nested(image("hero", "asset-2"))), catalog)).toBe(
      "Unknown image asset: asset-2",
    );
  });

  it("rejects image insertion after a block that is not top-level", () => {
    expect(
      validateEmailGenerationResult(result(nested(image("hero", "asset-1")), "hero"), catalog),
    ).toBe("Unknown image insertion block: hero");
  });
});
