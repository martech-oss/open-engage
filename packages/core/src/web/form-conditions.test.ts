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
