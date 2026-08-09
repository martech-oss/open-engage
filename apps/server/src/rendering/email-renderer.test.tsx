import { describe, expect, it } from "vitest";

import { defaultEmailDocumentV2 } from "@openengage/core/messaging";

import { renderEmailDocument } from "./email-renderer";

const context = {
  contact: { first_name: "太郎", email: "taro@example.com" },
  workspace: { name: "Example" },
  message: {},
};

const brand = {
  brandName: "Example Inc.",
  companyDescription: "",
  tone: "",
  logoAssetId: null,
  websiteUrl: "https://example.com",
  primaryColor: "#171717",
  backgroundColor: "#f4f5f7",
  textColor: "#171717",
  postalAddress: "東京都千代田区1-1",
  updatedAt: null,
};

describe("React Email renderer", () => {
  it("renders structured Markdown into HTML and plain text", async () => {
    const document = {
      ...defaultEmailDocumentV2(),
      previewText: "{{ contact.first_name }}さんへのお知らせ",
      blocks: [
        {
          id: "body",
          type: "markdown" as const,
          markdown: "# こんにちは\n\n{{ contact.first_name }}さん",
        },
      ],
    };
    const rendered = await renderEmailDocument(document, context, {
      purpose: "transactional",
      brand,
      assetUrls: {},
    });
    expect(rendered.html).toContain("こんにちは");
    expect(rendered.html).toContain("太郎さん");
    expect(rendered.text).toContain("こんにちは");
  });

  it("renders contact values as text instead of Markdown or HTML", async () => {
    const rendered = await renderEmailDocument(
      {
        ...defaultEmailDocumentV2(),
        blocks: [{ id: "body", type: "markdown", markdown: "{{ contact.first_name }}" }],
      },
      { ...context, contact: { first_name: "<img src=x onerror=alert(1)> **admin**" } },
      { purpose: "transactional", brand, assetUrls: {} },
    );
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).not.toContain("<strong>admin</strong>");
    expect(rendered.text).toContain("<img src=x onerror=alert(1)>");
  });

  it("owns the marketing compliance footer", async () => {
    const rendered = await renderEmailDocument(defaultEmailDocumentV2(), context, {
      purpose: "marketing",
      brand,
      assetUrls: {},
      preferenceUrl: "https://example.com/preferences",
      unsubscribeUrl: "https://example.com/unsubscribe",
    });
    expect(rendered.html).toContain("Example Inc.");
    expect(rendered.html).toContain("東京都千代田区1-1");
    expect(rendered.html).toContain("配信停止");
    expect(rendered.html).toContain("https://example.com/unsubscribe");
  });
});
