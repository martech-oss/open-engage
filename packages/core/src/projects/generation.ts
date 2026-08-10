import * as z from "zod";

import { projectBriefDraftInputSchema, projectBriefGeneratedDraftSchema } from "./definition.js";

const generationTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum);

const marketingBriefGenerationBaseSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
});
export const generateMarketingBriefInputSchema = z.discriminatedUnion("mode", [
  marketingBriefGenerationBaseSchema.extend({ mode: z.literal("create") }),
  marketingBriefGenerationBaseSchema.extend({
    mode: z.literal("refine"),
    current: projectBriefDraftInputSchema,
  }),
]);
export type GenerateMarketingBriefInput = z.infer<typeof generateMarketingBriefInputSchema>;

const capabilityGapSchema = z.object({
  capability: z.string().trim().min(1).max(191),
  detail: z.string().trim().min(1).max(1_000),
});

export const marketingBriefGenerationResultSchema = z.object({
  proposal: projectBriefGeneratedDraftSchema,
  summary: z.string().trim().min(1).max(2_000),
  capabilityGaps: z.array(capabilityGapSchema).max(50),
  assumptions: z.array(generationTextSchema(500)).max(50),
  warnings: z.array(generationTextSchema(500)).max(50),
});
export type MarketingBriefGenerationResult = z.infer<typeof marketingBriefGenerationResultSchema>;
