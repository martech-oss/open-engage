import { describe, expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";

import { renderLandingPage } from "./landing-renderer";

const baseOptions = {
  workspaceSlug: "acme",
  origin: "https://app.example.com",
  pageSlug: "launch",
  measurementToken: "",
  formBindings: [],
  preview: false,
};

function imagePolicy(html: string): string {
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
  return policy.split(";").find((directive) => directive.trim().startsWith("img-src")) ?? "";
}

describe("landing page rendering", () => {
  it("allows images only from the origins of the page's managed images", async () => {
    const html = await renderLandingPage(
      {
        ...emptyLandingPageDocument(),
        html: '<img data-oe-image="hero">',
        images: [{ refId: "hero", assetId: "asset-1", alt: "Hero" }],
      },
      { ...baseOptions, imageUrls: { "asset-1": "https://assets.example.com/a/acme/1/hero.png" } },
    );
    expect(html).toContain('src="https://assets.example.com/a/acme/1/hero.png"');
    expect(imagePolicy(html).trim()).toBe("img-src https://assets.example.com data:");
  });

  it("allows no network images when the page has none", async () => {
    const html = await renderLandingPage(emptyLandingPageDocument(), {
      ...baseOptions,
      imageUrls: {},
    });
    expect(imagePolicy(html).trim()).toBe("img-src data:");
  });
});
