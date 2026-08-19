import { describe, expect, it } from "vitest";

import { verifySignedToken } from "../platform/crypto";
import { applyEmailTracking, type EmailTrackingContext } from "./email-tracking";

const SECRET = "email-tracking-test-secret-at-least-32-chars";

function context(overrides: Partial<EmailTrackingContext> = {}): EmailTrackingContext {
  return {
    secret: SECRET,
    appUrl: "https://app.example.com",
    workspaceId: "workspace-1",
    deliveryId: "delivery-1",
    contactId: "contact-1",
    openTracking: true,
    clickTracking: true,
    ...overrides,
  };
}

async function destinationOf(html: string): Promise<string | undefined> {
  const token = /\/c\/([^"]+)"/.exec(html)?.[1];
  if (!token) return undefined;
  const payload = await verifySignedToken(SECRET, token.replaceAll("&amp;", "&"), "click");
  return payload?.url;
}

describe("applyEmailTracking", () => {
  it("leaves the html untouched when both toggles are off", async () => {
    const html = `<body><a href="https://example.com/pricing">Pricing</a></body>`;
    expect(
      await applyEmailTracking(html, context({ openTracking: false, clickTracking: false })),
    ).toBe(html);
  });

  it("routes an external link through the click redirect and preserves the destination", async () => {
    const result = await applyEmailTracking(
      `<body><a href="https://example.com/pricing">Pricing</a></body>`,
      context({ openTracking: false }),
    );
    expect(result).toContain("https://app.example.com/c/");
    expect(result).not.toContain(`href="https://example.com/pricing"`);
    await expect(destinationOf(result)).resolves.toBe("https://example.com/pricing");
  });

  it("round-trips a query string that react-email escaped as &amp;", async () => {
    const result = await applyEmailTracking(
      `<body><a href="https://example.com/p?utm_source=oe&amp;utm_medium=email">Go</a></body>`,
      context({ openTracking: false }),
    );
    await expect(destinationOf(result)).resolves.toBe(
      "https://example.com/p?utm_source=oe&utm_medium=email",
    );
    // The rewritten href must stay attribute-safe, so its own `&` is re-escaped.
    expect(result).not.toMatch(/href="[^"]*[^p;]&[a-z]+=/);
  });

  it("never rewrites unsubscribe, preference, or asset links", async () => {
    const html =
      `<body>` +
      `<a href="https://app.example.com/u/token-a">停止</a>` +
      `<a href="https://app.example.com/preference/token-b">設定</a>` +
      `<a href="https://app.example.com/a/acme/logo.png">logo</a>` +
      `</body>`;
    expect(await applyEmailTracking(html, context({ openTracking: false }))).toBe(html);
  });

  it("ignores mailto, tel, anchors, and relative links", async () => {
    const html =
      `<body><a href="mailto:hi@example.com">mail</a><a href="tel:+81312345678">tel</a>` +
      `<a href="#top">top</a><a href="/relative">rel</a></body>`;
    expect(await applyEmailTracking(html, context({ openTracking: false }))).toBe(html);
  });

  it("rewrites every occurrence of a repeated link", async () => {
    const result = await applyEmailTracking(
      `<body><a href="https://example.com/x">a</a><a href="https://example.com/x">b</a></body>`,
      context({ openTracking: false }),
    );
    expect(result.match(/\/c\//g)).toHaveLength(2);
  });

  it("injects the open pixel immediately before </body>", async () => {
    const result = await applyEmailTracking(
      `<body><p>Hello</p></body>`,
      context({ clickTracking: false }),
    );
    expect(result).toMatch(/<img src="https:\/\/app\.example\.com\/t\/[^"]+"[^>]*\/><\/body>$/);
    const token = /\/t\/([^"]+)"/.exec(result)?.[1] ?? "";
    const payload = await verifySignedToken(SECRET, token, "tracking");
    expect(payload).toMatchObject({
      workspaceId: "workspace-1",
      resourceId: "delivery-1",
      contactId: "contact-1",
    });
  });

  it("appends the pixel when the document has no closing body tag", async () => {
    const result = await applyEmailTracking("<p>Hello</p>", context({ clickTracking: false }));
    expect(result.startsWith("<p>Hello</p>")).toBe(true);
    expect(result).toContain("/t/");
  });

  it("does not accept a click token at the open endpoint", async () => {
    const result = await applyEmailTracking(
      `<body><a href="https://example.com/x">x</a></body>`,
      context({ openTracking: false }),
    );
    const token = /\/c\/([^"]+)"/.exec(result)?.[1] ?? "";
    await expect(verifySignedToken(SECRET, token, "tracking")).resolves.toBeNull();
  });
});
