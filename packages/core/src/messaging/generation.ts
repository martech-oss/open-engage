import * as z from "zod";

import { marketingCapabilitySnapshotSchema } from "../projects/schema.js";
import { emailBrandProfileSchema } from "./brand.js";
import { emailDocumentBlocks, emailDocumentV2Schema } from "./content.js";

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

/** Block, image and insertion checks shared by the Email Designer retry loop and Server. */
export function validateEmailGenerationResult(
  result: EmailGenerationResult,
  catalog: { publicImages: readonly { id: string }[] },
): string | null {
  const assetIds = new Set(catalog.publicImages.map((image) => image.id));
  const blockIds = new Set<string>();
  for (const block of emailDocumentBlocks(result.proposal.content)) {
    if (blockIds.has(block.id)) return `Duplicate block id: ${block.id}`;
    blockIds.add(block.id);
    if (block.type === "image" && !assetIds.has(block.source.assetId)) {
      return `Unknown image asset: ${block.source.assetId}`;
    }
  }
  const insertionPoints = new Set(result.proposal.content.blocks.map((block) => block.id));
  const invalidRequest = result.imageRequests.find(
    (request) => request.afterBlockId !== null && !insertionPoints.has(request.afterBlockId),
  );
  return invalidRequest ? `Unknown image insertion block: ${invalidRequest.afterBlockId}` : null;
}

/** Message variables a generation Agent may reference as {{ message.key }}. */
export const messageVariableCatalogSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(191),
      name: z.string().min(1).max(191),
      description: z.string().max(500),
    }),
  )
  .max(1_000);

/** Public image assets a generation Agent may place by id. */
export const publicImageCatalogSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(191),
      name: z.string().min(1).max(191),
      altText: z.string().max(500),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }),
  )
  .max(1_000);

export const emailGenerationAgentInitialDataSchema = z
  .object({
    request: generateEmailInputSchema,
    capabilities: marketingCapabilitySnapshotSchema,
    brand: emailBrandProfileSchema,
    variables: messageVariableCatalogSchema,
    publicImages: publicImageCatalogSchema,
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
