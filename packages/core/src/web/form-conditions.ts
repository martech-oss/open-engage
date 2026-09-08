import type { FormField, SignupFormDefinition } from "./form-schema";

export interface FormCondition {
  field: string;
  operator: "equals" | "not_equals" | "empty" | "not_empty";
  value?: string | undefined;
}

/** Pure, serializable implementation also embedded in the public form runtime. */
export function resolveFormFields(
  definition: SignupFormDefinition,
  values: Record<string, unknown>,
  answered: ReadonlySet<string> = new Set(),
): FormField[] {
  const fields = definition.fields?.length
    ? definition.fields
    : [
        {
          key: "email",
          kind: "standard" as const,
          type: "email" as const,
          required: true,
          progressive: false,
        },
      ];
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const visible = new Map<string, boolean>();
  const checking = new Set<string>();
  // Method syntax needs no bundler-generated name helper inside the serialized function.
  const rules = {
    matches(condition: FormCondition | undefined): boolean {
      if (!condition) return true;
      const raw = values[condition.field];
      const value =
        this.isVisible(condition.field) &&
        (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean")
          ? String(raw).trim()
          : "";
      if (condition.operator === "empty") return value === "";
      if (condition.operator === "not_empty") return value !== "";
      return condition.operator === "equals"
        ? value === condition.value
        : value !== condition.value;
    },
    isVisible(key: string): boolean {
      if (visible.has(key)) return visible.get(key) === true;
      if (checking.has(key)) return false;
      const field = byKey.get(key);
      if (!field) return false;
      checking.add(key);
      const result = this.matches(field.visibleWhen);
      checking.delete(key);
      visible.set(key, result);
      return result;
    },
  };
  let progressive = 0;
  return fields
    .filter((field) => {
      if (!rules.isVisible(field.key)) return false;
      if (!field.progressive || field.key === "email") return true;
      if (answered.has(field.key)) return false;
      return progressive++ < definition.progressiveMaxFields;
    })
    .map((field) => ({
      ...field,
      required: field.required || Boolean(field.requiredWhen && rules.matches(field.requiredWhen)),
    }));
}
