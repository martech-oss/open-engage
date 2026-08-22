import * as z from "zod";

import {
  approvedMarketingBriefContextSchema,
  marketingCapabilitySnapshotSchema,
  projectBriefReferenceSchema,
} from "../projects/schema.js";
import { normalizeSlug } from "../shared/schema.js";
import { segmentFilterSchema } from "./schema.js";

export const SEGMENT_RESOURCE_KINDS = [
  "tag",
  "static_segment",
  "company",
  "subscription_topic",
  "event",
  "custom_field",
] as const;

export const segmentResourceKindSchema = z.enum(SEGMENT_RESOURCE_KINDS);
export type SegmentResourceKind = z.infer<typeof segmentResourceKindSchema>;

export const segmentResourceOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(191),
  value: z.string().min(1).max(2_000),
  description: z.string().trim().max(500).optional(),
  dataType: z.enum(["text", "number", "boolean", "date", "select"]).optional(),
});
export type SegmentResourceOption = z.infer<typeof segmentResourceOptionSchema>;

export const segmentDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .transform((value) => normalizeSlug(value, { fallback: "segment" })),
    description: z.string().trim().max(1_000).default(""),
    kind: z.enum(["static", "dynamic"]),
    filter: segmentFilterSchema.nullable(),
    membershipSource: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((definition, context) => {
    if (definition.kind === "dynamic" && definition.filter === null) {
      context.addIssue({
        code: "custom",
        path: ["filter"],
        message: "dynamic segments require a filter",
      });
    }
    if (definition.kind === "static" && definition.filter !== null) {
      context.addIssue({
        code: "custom",
        path: ["filter"],
        message: "static segments cannot have a filter",
      });
    }
    if (definition.kind === "static" && !definition.membershipSource) {
      context.addIssue({
        code: "custom",
        path: ["membershipSource"],
        message: "static segments require a membership source",
      });
    }
    if (definition.kind === "dynamic" && definition.membershipSource !== null) {
      context.addIssue({
        code: "custom",
        path: ["membershipSource"],
        message: "dynamic segments cannot have a membership source",
      });
    }
  });
export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

export const segmentResourceRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
  kind: segmentResourceKindSchema,
  label: z.string().trim().min(1).max(191),
  reason: z.string().trim().min(1).max(1_000),
});
export type SegmentResourceRequest = z.infer<typeof segmentResourceRequestSchema>;

export const segmentGenerationContinuationSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  plannedLogic: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  resources: z.array(segmentResourceRequestSchema).min(1).max(100),
});
export type SegmentGenerationContinuation = z.infer<typeof segmentGenerationContinuationSchema>;

export const segmentResourceResolutionSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
  resourceId: z.string().min(1),
});
export type SegmentResourceResolution = z.infer<typeof segmentResourceResolutionSchema>;

const requestBaseSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  continuation: segmentGenerationContinuationSchema.optional(),
  resolutions: z.array(segmentResourceResolutionSchema).max(100).optional(),
});

export const generateSegmentInputSchema = projectBriefReferenceSchema.and(
  z.discriminatedUnion("mode", [
    requestBaseSchema.extend({ mode: z.literal("create") }),
    requestBaseSchema.extend({
      mode: z.literal("refine"),
      currentDefinition: segmentDefinitionSchema,
    }),
  ]),
);
export type GenerateSegmentInput = z.infer<typeof generateSegmentInputSchema>;

const generationReadyBase = {
  status: z.literal("ready"),
  definition: segmentDefinitionSchema,
  summary: z.string().trim().min(1).max(2_000),
  inclusion: z.array(z.string().trim().min(1).max(500)).max(100),
  exclusion: z.array(z.string().trim().min(1).max(500)).max(100),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
  deliveryGuardrails: z.array(z.string().trim().min(1).max(500)).max(20),
} as const;

export const segmentGenerationAgentResultSchema = z.discriminatedUnion("status", [
  z.object(generationReadyBase),
  z.object({
    status: z.literal("needs_input"),
    summary: z.string().trim().min(1).max(2_000),
    plannedLogic: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    resources: z.array(segmentResourceRequestSchema).min(1).max(100),
  }),
]);
export type SegmentGenerationAgentResult = z.infer<typeof segmentGenerationAgentResultSchema>;

export const segmentGenerationResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...generationReadyBase,
    preview: z.object({
      matchedCount: z.number().int().nonnegative(),
      capped: z.boolean(),
    }),
  }),
  z.object({
    status: z.literal("needs_input"),
    summary: z.string().trim().min(1).max(2_000),
    plannedLogic: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    continuation: segmentGenerationContinuationSchema,
    resources: z
      .array(
        segmentResourceRequestSchema.extend({
          options: z.array(segmentResourceOptionSchema).max(1_000),
        }),
      )
      .min(1)
      .max(100),
  }),
]);
export type SegmentGenerationResult = z.infer<typeof segmentGenerationResultSchema>;

export const segmentGenerationCatalogSchema = z.object({
  tags: z.array(segmentResourceOptionSchema).max(1_000),
  staticSegments: z.array(segmentResourceOptionSchema).max(1_000),
  companies: z.array(segmentResourceOptionSchema).max(1_000),
  subscriptionTopics: z.array(segmentResourceOptionSchema).max(1_000),
  events: z.array(segmentResourceOptionSchema).max(1_000),
  customFields: z.array(segmentResourceOptionSchema).max(1_000),
  stages: z.array(z.string().min(1).max(191)).max(1_000),
});
export type SegmentGenerationCatalog = z.infer<typeof segmentGenerationCatalogSchema>;

export const segmentDesignerInitialDataSchema = z
  .object({
    request: generateSegmentInputSchema,
    catalog: segmentGenerationCatalogSchema,
    trustedBrief: approvedMarketingBriefContextSchema.optional(),
    capabilities: marketingCapabilitySnapshotSchema,
  })
  .strict();
export type SegmentDesignerInitialData = z.infer<typeof segmentDesignerInitialDataSchema>;
