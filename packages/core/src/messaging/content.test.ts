import { describe, expect, it } from "vitest";

import { defaultEmailDocumentV2, emailDocumentV2Schema } from "./content";

describe("EmailDocumentV2", () => {
  it("rejects the legacy HTML document schema", () => {
    expect(
      emailDocumentV2Schema.safeParse({
        schemaVersion: 1,
        backgroundColor: "#f4f5f7",
        contentColor: "#ffffff",
        width: 600,
        blocks: [{ id: "body", type: "text", html: "<p>Hello</p>" }],
      }).success,
    ).toBe(false);
  });

  it("rejects raw HTML and unsafe Markdown links", () => {
    const base = defaultEmailDocumentV2();
    expect(
      emailDocumentV2Schema.safeParse({
        ...base,
        blocks: [{ id: "body", type: "markdown", markdown: "<script>alert(1)</script>" }],
      }).success,
    ).toBe(false);
    expect(
      emailDocumentV2Schema.safeParse({
        ...base,
        blocks: [{ id: "body", type: "markdown", markdown: "[click](javascript:alert(1))" }],
      }).success,
    ).toBe(false);
  });

  it("accepts approved template variables in HTTPS links", () => {
    const parsed = emailDocumentV2Schema.parse({
      ...defaultEmailDocumentV2(),
      blocks: [
        {
          id: "cta",
          type: "button",
          label: "確認",
          href: "https://example.com/orders/{{ contact.order_id }}",
        },
      ],
    });
    expect(parsed.blocks[0]).toMatchObject({ type: "button" });
  });

  it("accepts only managed asset image sources", () => {
    const base = defaultEmailDocumentV2();
    expect(
      emailDocumentV2Schema.safeParse({
        ...base,
        blocks: [
          {
            id: "hero",
            type: "image",
            source: { kind: "legacy_url", url: "https://example.com/hero.png" },
            alt: "Hero",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
