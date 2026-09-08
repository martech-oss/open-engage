import * as z from "zod";

export const STANDARD_FORM_FIELD_KEYS = ["email", "firstName", "lastName", "phone"] as const;
export const standardFormFieldKeySchema = z.enum(STANDARD_FORM_FIELD_KEYS);
export type StandardFormFieldKey = z.infer<typeof standardFormFieldKeySchema>;

export const FORM_FIELD_INPUT_TYPES = [
  "email",
  "text",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
] as const;
export const formFieldInputTypeSchema = z.enum(FORM_FIELD_INPUT_TYPES);
export type FormFieldInputType = z.infer<typeof formFieldInputTypeSchema>;

export const formConditionSchema = z
  .object({
    field: z.string().min(1).max(191),
    operator: z.enum(["equals", "not_equals", "empty", "not_empty"]),
    value: z.string().max(1000).optional(),
  })
  .refine((c) => c.operator === "empty" || c.operator === "not_empty" || c.value !== undefined, {
    message: "比較値を指定してください",
  });

/**
 * `standard` keys map onto contact columns; `custom` keys land in
 * `contacts.custom_fields` under the same key. Definitions written before
 * custom fields existed omit `kind`, so it defaults to `standard`.
 */
export const formFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(191)
    .regex(/^[A-Za-z0-9_-]+$/, "英数字、アンダースコア、ハイフンで入力してください"),
  kind: z.enum(["standard", "custom"]).default("standard"),
  label: z.string().trim().max(191).optional(),
  type: formFieldInputTypeSchema.default("text"),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  /**
   * Progressive Profiling: once the identified visitor already has a value for
   * this field, the form drops it and shows the next unanswered one instead.
   */
  progressive: z.boolean().default(false),
  visibleWhen: formConditionSchema.optional(),
  requiredWhen: formConditionSchema.optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const signupFormDefinitionSchema = z
  .object({
    style: z.enum(["inline", "floating-bar", "floating-box", "modal"]).optional(),
    fields: z.array(formFieldSchema).max(50).optional(),
    /** Cap on how many progressive fields one visit may ask for. */
    progressiveMaxFields: z.number().int().min(1).max(10).default(3),
  })
  .superRefine((definition, context) => {
    const fields = new Map((definition.fields ?? []).map((field) => [field.key, field]));
    if (fields.size !== (definition.fields?.length ?? 0))
      context.addIssue({ code: "custom", message: "項目キーは重複できません", path: ["fields"] });
    for (const [index, field] of (definition.fields ?? []).entries()) {
      const visit = (key: string, seen: Set<string>): boolean => {
        if (seen.has(key)) return false;
        const node = fields.get(key);
        if (!node) return false;
        return [node.visibleWhen, node.requiredWhen].every(
          (condition) => !condition || visit(condition.field, new Set([...seen, key])),
        );
      };
      if (!visit(field.key, new Set()))
        context.addIssue({
          code: "custom",
          message: "条件は存在する項目を参照し、循環しないようにしてください",
          path: ["fields", index],
        });
    }
  });
export type SignupFormDefinition = z.infer<typeof signupFormDefinitionSchema>;
