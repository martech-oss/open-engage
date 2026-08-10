import { describe, expect, it } from "vitest";

import { generateSegmentInputSchema } from "./generation.js";

const briefReferenceCases = [
  ["without a brief reference", {}, true],
  ["with a complete brief reference", { projectId: "project-id", briefRevision: 2 }, true],
  ["with only projectId", { projectId: "project-id" }, false],
  ["with only briefRevision", { briefRevision: 2 }, false],
] as const;

describe("segment generation brief reference", () => {
  it.each(briefReferenceCases)("validates %s", (_label, reference, expected) => {
    expect(
      generateSegmentInputSchema.safeParse({
        mode: "create",
        prompt: "Create a trial activation segment",
        ...reference,
      }).success,
    ).toBe(expected);
  });
});
