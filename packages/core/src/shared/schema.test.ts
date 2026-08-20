import { describe, expect, it } from "vitest";

import { formatIssuePath } from "./schema";

describe("formatIssuePath", () => {
  it("formats identifiers, numeric indexes, and quoted property names", () => {
    expect(formatIssuePath(["profile", "first_name", 2, "display-name"])).toBe(
      '$.profile.first_name[2]["display-name"]',
    );
    expect(formatIssuePath([])).toBe("$");
  });
});
