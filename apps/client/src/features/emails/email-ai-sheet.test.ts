import { describe, expect, it } from "vitest";

import { defaultEmailDocumentV2 } from "@openengage/core/messaging";

import { insertGeneratedImage } from "./email-ai-sheet";

describe("insertGeneratedImage", () => {
  it("inserts the confirmed image after the requested block", () => {
    const document = defaultEmailDocumentV2();
    const result = insertGeneratedImage(
      document,
      { requestId: "hero", afterBlockId: "body", prompt: "abstract", alt: "抽象的な図形" },
      {
        assetId: "asset-1",
        previewUrl: "/api/email-images/asset-1/preview",
        alt: "抽象的な図形",
        expiresAt: new Date().toISOString(),
      },
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toMatchObject({
      type: "image",
      source: { kind: "asset", assetId: "asset-1" },
    });
  });
});
