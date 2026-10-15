import { describe, expect, it } from "vitest";

import { resolveFormFields } from "./form-conditions";
import { signupFormDefinitionSchema } from "./schema";

describe("shared form conditions", () => {
  it("rejects cycles and unknown dependencies", () => {
    const field = (key: string, dependency: string) => ({
      key,
      visibleWhen: { field: dependency, operator: "equals", value: "yes" },
    });
    expect(
      signupFormDefinitionSchema.safeParse({ fields: [field("a", "b"), field("b", "a")] }).success,
    ).toBe(false);
    expect(signupFormDefinitionSchema.safeParse({ fields: [field("a", "missing")] }).success).toBe(
      false,
    );
  });
  it("validates densely shared condition chains without re-walking every path", () => {
    // Each field depends on the next two, so the graph has ~2^49 distinct paths.
    const condition = (key: string) => ({ field: key, operator: "not_empty" as const });
    const fields = Array.from({ length: 50 }, (_, index) => ({
      key: `f${index}`,
      ...(index < 48
        ? { visibleWhen: condition(`f${index + 1}`), requiredWhen: condition(`f${index + 2}`) }
        : {}),
    }));
    const started = performance.now();
    expect(signupFormDefinitionSchema.safeParse({ fields }).success).toBe(true);
    const cyclic = fields.map((field, index) =>
      index === 49 ? { ...field, visibleWhen: condition("f0") } : field,
    );
    const result = signupFormDefinitionSchema.safeParse({ fields: cyclic });
    expect(result.success).toBe(false);
    // Only f48 has no path into the f0 → … → f49 → f0 cycle.
    expect(result.error?.issues).toHaveLength(49);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
  it("ignores values of hidden dependencies and combines progressive and required rules", () => {
    const definition = signupFormDefinitionSchema.parse({
      fields: [
        { key: "email", type: "email", required: true },
        { key: "company", kind: "custom" },
        {
          key: "size",
          kind: "custom",
          visibleWhen: { field: "company", operator: "not_empty" },
          requiredWhen: { field: "company", operator: "not_empty" },
        },
        { key: "phone", progressive: true, required: true },
      ],
    });
    expect(
      resolveFormFields(definition, { email: "a@example.com" }, new Set(["phone"])).map(
        (f) => f.key,
      ),
    ).toEqual(["email", "company"]);
    expect(
      resolveFormFields(definition, { company: "Acme" }, new Set()).find((f) => f.key === "size")
        ?.required,
    ).toBe(true);
    expect(resolveFormFields(definition, {}, new Set()).some((f) => f.key === "phone")).toBe(true);
  });
});
