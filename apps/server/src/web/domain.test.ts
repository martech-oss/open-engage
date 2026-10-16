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

  it.each([
    ["/docs/a/b", "/docs/*", true],
    ["/docs", "/docs/*", false],
    ["/docs/", "/docs/*", true],
    ["/a/b/c", "*/b/*", true],
    ["/abcabc", "*abc", true],
    ["/abab", "/*ab*ab", true],
    ["/ab", "/*ab*ab", false],
    ["/aXbXc", "/a*b*c", true],
    ["/aXcXb", "/a*b*c", false],
    ["/abc", "/abc", true],
    ["/abc", "/ab", false],
    ["/a**b", "/a**b", true],
    ["/ab", "/a**b", true],
  ])("matches %s against %s like an anchored glob", (path, pattern, expected) => {
    expect(pagePatternMatches(`https://example.com${path}`, pattern)).toBe(expected);
  });

  it("matches adversarial wildcard patterns without backtracking", () => {
    const pattern = `/${"a*".repeat(240)}b`;
    const started = performance.now();
    expect(pagePatternMatches(`https://example.com/${"a".repeat(8_000)}`, pattern)).toBe(false);
    // Paths beyond the length cap never match, even a catch-all suffix.
    expect(pagePatternMatches(`https://example.com/${"a".repeat(9_000)}b`, "*b")).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
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
