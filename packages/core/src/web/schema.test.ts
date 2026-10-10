import { describe, expect, it } from "vitest";

import { siteMessageScheduleSchema, siteMessageWriteSchema } from "./schema";

describe("siteMessageWriteSchema CTA URLs", () => {
  const message = {
    name: "Welcome",
    headline: "Hello",
    body: "Contact us",
    ctaLabel: "Contact",
    pagePattern: "*",
    startsAt: null,
    endsAt: null,
  };

  it.each([
    null,
    "http://example.com/contact",
    "https://example.com/contact?next=javascript:example",
    "HTTPS://EXAMPLE.COM/contact",
  ])("accepts an HTTP(S) destination or no CTA: %s", (ctaUrl) => {
    expect(siteMessageWriteSchema.parse({ ...message, ctaUrl }).ctaUrl).toBe(ctaUrl);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "\tjava\nscript:alert(1)",
    "java%73cript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "mailto:contact@example.com",
    "//example.com/contact",
    "/contact",
    "#contact",
    "not a URL",
  ])("rejects a non-HTTP(S) destination: %s", (ctaUrl) => {
    const result = siteMessageWriteSchema.safeParse({ ...message, ctaUrl });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected an invalid CTA URL");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["ctaUrl"] })]),
    );
  });
});

describe("siteMessageScheduleSchema", () => {
  it("accepts an ordered schedule", () => {
    expect(
      siteMessageScheduleSchema.safeParse({
        startsAt: "2026-08-23T00:15:00.000Z",
        endsAt: "2026-08-23T01:45:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an end that is not after the start", () => {
    const result = siteMessageScheduleSchema.safeParse({
      startsAt: "2026-08-23T01:45:00.000Z",
      endsAt: "2026-08-23T00:15:00.000Z",
    });
    if (result.success) throw new Error("Expected an invalid schedule");
    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ["endsAt"], message: "endsAt must be after startsAt" }),
    ]);
  });
});
