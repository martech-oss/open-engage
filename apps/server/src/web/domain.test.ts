import { describe, expect, it } from "vitest";

import { escapeHtml } from "../rendering/html";
import { originAllowed, pagePatternMatches, redactFormPayload } from "./domain";

describe("public boundary primitives", () => {
  it("keeps domain matching scoped to the exact domain or a subdomain", () => {
    expect(originAllowed("https://news.example.com", ["example.com"])).toBe(true);
    expect(originAllowed("https://example.com.attacker.test", ["example.com"])).toBe(false);
  });

  it("matches page wildcards without treating regex punctuation as syntax", () => {
    expect(pagePatternMatches("https://example.com/docs/a.b?draft=1", "/docs/*.b?draft=1")).toBe(
      true,
    );
    expect(pagePatternMatches("https://example.com/docs/axb?draft=1", "/docs/*.b?draft=1")).toBe(
      false,
    );
  });

  it("redacts transport metadata without mutating the submitted payload", () => {
    const payload = { email: "person@example.com", turnstileToken: "secret", oe_v: "visitor" };
    expect(redactFormPayload(payload)).toEqual({ email: "person@example.com" });
    expect(payload).toHaveProperty("turnstileToken", "secret");
  });

  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<a title="'">&`)).toBe("&lt;a title=&quot;&#039;&quot;&gt;&amp;");
  });
});
