import { describe, expect, it } from "vitest";

import { slugify } from "./utils";

describe("slugify", () => {
  it("uses a stable fallback without time-based client authority", () => {
    expect(slugify("日本語", { fallback: "segment" })).toBe("segment");
    expect(slugify("", { fallback: "workspace" })).toBe("workspace");
  });
});
