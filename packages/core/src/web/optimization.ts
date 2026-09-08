import * as z from "zod";
export const experimentVariantSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  name: z.string().trim().min(1).max(100),
  pageVersionId: z.string().min(1),
  weight: z.number().int().min(1).max(100),
});
export const experimentWriteSchema = z
  .object({
    id: z.uuid(),
    pageId: z.string().min(1),
    name: z.string().trim().min(1).max(191),
    variants: z.array(experimentVariantSchema).min(2).max(5),
  })
  .superRefine((value, context) => {
    if (value.variants.reduce((sum, item) => sum + item.weight, 0) !== 100)
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "配分率の合計を100%にしてください",
      });
    if (
      new Set(value.variants.map((item) => item.id)).size !== value.variants.length ||
      new Set(value.variants.map((item) => item.pageVersionId)).size !== value.variants.length
    )
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "案とページ版はそれぞれ一意にしてください",
      });
  });
export const experimentSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  name: z.string(),
  status: z.enum(["draft", "running", "ended"]),
  variants: z.array(experimentVariantSchema),
  winnerVariantId: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ExperimentWrite = z.infer<typeof experimentWriteSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export function chooseExperimentVariant(variants: Experiment["variants"], bucket: number) {
  let boundary = 0;
  for (const variant of variants) {
    boundary += variant.weight;
    if (bucket < boundary) return variant;
  }
  return variants.at(-1)!;
}
export const dynamicContentWriteSchema = z
  .object({
    pageId: z.string().min(1),
    slotId: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
    fallbackHtml: z.string().max(20000),
    rules: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          segmentId: z.string().min(1),
          priority: z.number().int().min(0).max(1000),
          html: z.string().max(20000),
        }),
      )
      .max(30),
  })
  .superRefine((value, context) => {
    if (new Set(value.rules.map((rule) => rule.id)).size !== value.rules.length)
      context.addIssue({
        code: "custom",
        path: ["rules"],
        message: "ルールIDを一意にしてください",
      });
  });
export const dynamicContentSchema = dynamicContentWriteSchema.extend({ updatedAt: z.string() });
export type DynamicContentWrite = z.infer<typeof dynamicContentWriteSchema>;
export const experimentReportSchema = z.object({
  experimentId: z.string(),
  asOf: z.string(),
  from: z.string(),
  to: z.string(),
  variants: z.array(
    z.object({
      variantId: z.string(),
      name: z.string(),
      visitors: z.number(),
      conversions: z.number(),
      conversionRate: z.number(),
      pendingVisitors: z.number(),
    }),
  ),
  cohorts: z.array(
    z.object({
      day: z.string(),
      variantId: z.string(),
      visitors: z.number(),
      conversions: z.number(),
      pendingVisitors: z.number(),
    }),
  ),
});
