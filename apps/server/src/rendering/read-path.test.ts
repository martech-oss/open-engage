import { describe, expect, it } from "vitest";

import { readPath } from "./read-path";

describe("readPath", () => {
  it("reads nested object properties and does not traverse arrays", () => {
    expect(readPath({ profile: { name: "Ada" } }, "profile.name")).toBe("Ada");
    expect(readPath({ profile: { name: "Ada" } }, "profile.missing")).toBeUndefined();
    expect(readPath({ rows: [{ name: "Ada" }] }, "rows.0.name")).toBeUndefined();
  });
});
