import * as z from "zod";
// Compatibility barrel for the public `@openengage/core/projects` entrypoint.
export * from "./definition.js";
export * from "./dto.js";
export * from "./generation.js";
export * from "./workflow.js";

export const campaignCostInputSchema = z.object({
  bookedOn: z.iso.date(),
  category: z.string().trim().min(1).max(191),
  amount: z
    .number()
    .finite()
    .nonnegative()
    .max(1_000_000_000_000)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.001,
      "金額は小数2桁までです",
    ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
});
export const campaignCostSchema = campaignCostInputSchema.extend({
  id: z.string(),
  projectId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CampaignCostInput = z.infer<typeof campaignCostInputSchema>;
