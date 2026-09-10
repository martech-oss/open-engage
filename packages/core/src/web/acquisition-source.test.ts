import { describe, expect, it } from "vitest";

import { classifyAcquisitionSource } from "./index";

describe("acquisition source classification", () => {
  it("uses UTM dimensions before the referrer and distinguishes paid social", () => {
    expect(
      classifyAcquisitionSource({
        url: "https://example.com/?utm_source=Google&utm_medium=cpc&utm_campaign=Autumn",
        referrer: "https://bing.com/search",
      }),
    ).toEqual({ channel: "paid_search", source: "google", medium: "cpc", campaign: "Autumn" });
    expect(classifyAcquisitionSource({ utm_source: "facebook", utm_medium: "cpc" }).channel).toBe(
      "paid_social",
    );
  });
  it("classifies search and referrals, and treats same-site navigation as direct", () => {
    expect(
      classifyAcquisitionSource({
        url: "https://example.com/pricing",
        referrer: "https://www.google.co.jp/search?q=x",
      }),
    ).toMatchObject({ channel: "organic_search", source: "www.google.co.jp", medium: "organic" });
    expect(
      classifyAcquisitionSource({
        url: "https://example.com/pricing",
        referrer: "https://partner.test/path?secret=1",
      }),
    ).toMatchObject({ channel: "referral", source: "partner.test" });
    expect(
      classifyAcquisitionSource({
        url: "https://example.com/pricing",
        referrer: "https://example.com/home",
      }).channel,
    ).toBe("direct");
  });
  it("keeps missing data distinct from observed direct traffic and tolerates invalid input", () => {
    expect(classifyAcquisitionSource({}).channel).toBe("unknown");
    expect(classifyAcquisitionSource({ url: "https://example.com/" }).channel).toBe("direct");
    expect(classifyAcquisitionSource({ url: "javascript:alert(1)", referrer: 42 }).channel).toBe(
      "unknown",
    );
    expect(classifyAcquisitionSource(null).channel).toBe("unknown");
  });
});

it("treats configured sibling domains as internal without confusing lookalike hosts", () => {
  const internal = ["example.com", "example.jp"];
  expect(
    classifyAcquisitionSource(
      { url: "https://landing.example.com/", referrer: "https://www.example.jp/pricing" },
      internal,
    ).channel,
  ).toBe("direct");
  expect(
    classifyAcquisitionSource(
      { url: "https://example.com/", referrer: "https://example.com.attacker.test/" },
      internal,
    ).channel,
  ).toBe("referral");
});
