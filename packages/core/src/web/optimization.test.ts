import { expect, it } from "vitest";

import { chooseExperimentVariant, experimentWriteSchema } from "./optimization";
it("requires two to five unique versions with a complete percentage allocation", () => {
  const variants = [
    { id: "a", name: "A", pageVersionId: "v1", weight: 50 },
    { id: "b", name: "B", pageVersionId: "v2", weight: 50 },
  ];
  expect(
    experimentWriteSchema.safeParse({
      id: crypto.randomUUID(),
      pageId: "p",
      name: "Test",
      variants,
    }).success,
  ).toBe(true);
  expect(chooseExperimentVariant(variants, 49.99).id).toBe("a");
  expect(chooseExperimentVariant(variants, 50).id).toBe("b");
  expect(
    experimentWriteSchema.safeParse({
      id: crypto.randomUUID(),
      pageId: "p",
      name: "Test",
      variants: [...variants, { ...variants[0], weight: 1 }],
    }).success,
  ).toBe(false);
});
