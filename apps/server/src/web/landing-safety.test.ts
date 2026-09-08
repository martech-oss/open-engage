import { describe, expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";

import { sanitizeLandingDocument } from "./landing-safety";

describe("landing page safe HTML and CSS", () => {
  it("strips scripts, handlers, external resources and preserves managed references", async () => {
    const doc = emptyLandingPageDocument();
    doc.html =
      '<script>alert(1)</script><img src="https://evil.test/track" onerror="alert(1)"><a href="javascript:alert(1)">x</a><div data-oe-form="signup"></div>';
    doc.forms = [
      {
        refId: "signup",
        name: "Signup",
        definition: { progressiveMaxFields: 3 },
        successMessage: "Thanks",
        turnstileEnabled: false,
      },
    ];
    const result = await sanitizeLandingDocument(doc);
    expect(result.html).not.toMatch(/script|onerror|evil\.test|javascript:/);
    expect(result.html).toContain('data-oe-form="signup"');
  });
  it("rejects CSS network loads and undefined managed slots", async () => {
    await expect(
      sanitizeLandingDocument({
        ...emptyLandingPageDocument(),
        css: '@import "https://evil.test";',
      }),
    ).rejects.toThrow();
    await expect(
      sanitizeLandingDocument({
        ...emptyLandingPageDocument(),
        css: "body{background:url(https://evil.test)}",
      }),
    ).rejects.toThrow();
    await expect(
      sanitizeLandingDocument({
        ...emptyLandingPageDocument(),
        html: '<div data-oe-form="missing"></div>',
      }),
    ).rejects.toThrow();
  });
  it("keeps repeated sanitization stable and supports safe brand CSS variables", async () => {
    const doc = {
      ...emptyLandingPageDocument(),
      html: '<main id="signup"><a href="#signup">相談する</a></main>',
      css: ":root{--brand:#0369a1}main{color:var(--brand)}",
    };
    const first = await sanitizeLandingDocument(doc);
    expect(await sanitizeLandingDocument(first)).toEqual(first);
    expect(first.html).toContain('id="signup"');
    expect(first.html).toContain('href="#signup"');
  });
});
