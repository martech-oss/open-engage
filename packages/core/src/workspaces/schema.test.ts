import { describe, expect, it } from "vitest";

import { normalizeSlug } from "../shared/schema";
import { capabilitiesForRole, workspaceSchema } from "./schema";

describe("workspace capabilities", () => {
  it.each([
    ["owner", true, true, true, true],
    ["admin", true, true, true, true],
    ["marketer", true, true, false, false],
    ["analyst", true, false, false, false],
    ["viewer", false, false, false, false],
  ] as const)(
    "derives the complete %s capability matrix",
    (role, viewReports, manageMarketing, manageWorkspace, manageApiKeys) => {
      expect(capabilitiesForRole(role)).toEqual({
        viewReports,
        manageMarketing,
        manageWorkspace,
        manageApiKeys,
      });
    },
  );

  it("requires server-derived capabilities in workspace DTOs", () => {
    expect(() =>
      workspaceSchema.parse({
        id: "workspace-id",
        name: "OpenEngage",
        slug: "openengage",
        logo: null,
        timezone: "UTC",
        created_at: 1,
        role: "owner",
      }),
    ).toThrow();
  });
});

describe("normalizeSlug", () => {
  it.each([
    ["  Acme & Partners  ", "acme-partners"],
    ["Multiple___spaces", "multiple-spaces"],
    ["日本語の名前", "workspace"],
    ["", "workspace"],
  ])("normalizes %j to %s", (name, expected) => {
    expect(normalizeSlug(name, { fallback: "workspace" })).toBe(expected);
  });

  it("bounds the normalized slug without leaving a trailing separator", () => {
    expect(normalizeSlug("a".repeat(20) + "-tail", { fallback: "resource", maxLength: 20 })).toBe(
      "a".repeat(20),
    );
  });

  it("also bounds the stable default when both the value and fallback are non-ASCII", () => {
    expect(normalizeSlug("", { fallback: "日本語", maxLength: 4 })).toBe("reso");
  });
});
