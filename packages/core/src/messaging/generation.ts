import * as z from "zod";

import { marketingCapabilitySnapshotSchema } from "../projects/schema.js";
import { emailBrandProfileSchema } from "./brand.js";
import { emailDocumentV2Schema } from "./content.js";

export const emailPurposeSchema = z.enum(["transactional", "marketing"]);
export type EmailPurpose = z.infer<typeof emailPurposeSchema>;

export const emailGenerationProposalSchema = z.object({
  name: z.string().trim().min(1).max(191),
  subject: z.string().trim().min(1).max(998),
  content: emailDocumentV2Schema,
});
export type EmailGenerationProposal = z.infer<typeof emailGenerationProposalSchema>;

export const emailImageRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
  afterBlockId: z.string().min(1).max(191).nullable(),
  prompt: z.string().trim().min(1).max(2_000),
  alt: z.string().trim().min(1).max(500),
});
export type EmailImageRequest = z.infer<typeof emailImageRequestSchema>;

export const generateEmailInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    purpose: emailPurposeSchema,
    prompt: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    mode: z.literal("refine"),
    purpose: emailPurposeSchema,
    prompt: z.string().trim().min(1).max(4_000),
    current: emailGenerationProposalSchema,
  }),
]);
export type GenerateEmailInput = z.infer<typeof generateEmailInputSchema>;

export const emailGenerationResultSchema = z.object({
  proposal: emailGenerationProposalSchema,
  summary: z.string().trim().min(1).max(2_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
  imageRequests: z.array(emailImageRequestSchema).max(1),
});
export type EmailGenerationResult = z.infer<typeof emailGenerationResultSchema>;

export const emailGenerationAgentInitialDataSchema = z
  .object({
    request: generateEmailInputSchema,
    capabilities: marketingCapabilitySnapshotSchema,
    brand: emailBrandProfileSchema,
    variables: z
      .array(
        z.object({
          key: z.string().min(1).max(191),
          name: z.string().min(1).max(191),
          description: z.string().max(500),
        }),
      )
      .max(1_000),
    publicImages: z
      .array(
        z.object({
          id: z.string().min(1).max(191),
          name: z.string().min(1).max(191),
          altText: z.string().max(500),
          width: z.number().int().positive().nullable(),
          height: z.number().int().positive().nullable(),
        }),
      )
      .max(1_000),
  })
  .strict();
export type EmailGenerationAgentInitialData = z.infer<typeof emailGenerationAgentInitialDataSchema>;

export const generateEmailImageInputSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2_000),
  alt: z.string().trim().min(1).max(500),
});
export type GenerateEmailImageInput = z.infer<typeof generateEmailImageInputSchema>;

export const generatedEmailImageSchema = z.object({
  assetId: z.string(),
  previewUrl: z.string(),
  alt: z.string(),
  expiresAt: z.string(),
});
export type GeneratedEmailImage = z.infer<typeof generatedEmailImageSchema>;
