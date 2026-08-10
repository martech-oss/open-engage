import * as z from "zod";

import { automationDefinitionSchema } from "./schema.js";

export const AUTOMATION_RESOURCE_KINDS = [
  "email_template",
  "form",
  "segment",
  "tag",
  "webhook_endpoint",
  "subscription_topic",
] as const;

export const automationResourceKindSchema = z.enum(AUTOMATION_RESOURCE_KINDS);
export type AutomationResourceKind = z.infer<typeof automationResourceKindSchema>;

export const automationResourceOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(500).optional(),
});
export type AutomationResourceOption = z.infer<typeof automationResourceOptionSchema>;

export const automationResourceRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
  kind: automationResourceKindSchema,
  label: z.string().trim().min(1).max(191),
  reason: z.string().trim().min(1).max(1_000),
  canOmit: z.boolean(),
});
export type AutomationResourceRequest = z.infer<typeof automationResourceRequestSchema>;

export const automationGenerationContinuationSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  plannedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
  resources: z.array(automationResourceRequestSchema).min(1).max(100),
});
export type AutomationGenerationContinuation = z.infer<
  typeof automationGenerationContinuationSchema
>;

export const automationResourceResolutionSchema = z.discriminatedUnion("decision", [
  z.object({
    requestId: z.string().trim().min(1).max(80),
    decision: z.literal("select"),
    resourceId: z.string().min(1),
  }),
  z.object({
    requestId: z.string().trim().min(1).max(80),
    decision: z.literal("omit"),
  }),
]);
export type AutomationResourceResolution = z.infer<typeof automationResourceResolutionSchema>;

const generationRequestBaseSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  projectId: z.string().min(1).optional(),
  briefRevision: z.number().int().positive().optional(),
  continuation: automationGenerationContinuationSchema.optional(),
  resolutions: z.array(automationResourceResolutionSchema).max(100).optional(),
});

export const generateAutomationInputSchema = z.discriminatedUnion("mode", [
  generationRequestBaseSchema.extend({ mode: z.literal("create") }),
  generationRequestBaseSchema.extend({
    mode: z.literal("refine"),
    currentDefinition: automationDefinitionSchema,
  }),
]);
export type GenerateAutomationInput = z.infer<typeof generateAutomationInputSchema>;

const automationGenerationReadySchema = z.object({
  status: z.literal("ready"),
  definition: automationDefinitionSchema,
  summary: z.string().trim().min(1).max(2_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
});

export const automationGenerationAgentResultSchema = z.discriminatedUnion("status", [
  automationGenerationReadySchema,
  z.object({
    status: z.literal("needs_input"),
    summary: z.string().trim().min(1).max(2_000),
    plannedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
    resources: z.array(automationResourceRequestSchema).min(1).max(100),
  }),
]);
export type AutomationGenerationAgentResult = z.infer<typeof automationGenerationAgentResultSchema>;

export const automationGenerationResultSchema = z.discriminatedUnion("status", [
  automationGenerationReadySchema,
  z.object({
    status: z.literal("needs_input"),
    summary: z.string().trim().min(1).max(2_000),
    plannedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
    continuation: automationGenerationContinuationSchema,
    resources: z
      .array(
        automationResourceRequestSchema.extend({
          options: z.array(automationResourceOptionSchema).max(1_000),
        }),
      )
      .min(1)
      .max(100),
  }),
]);
export type AutomationGenerationResult = z.infer<typeof automationGenerationResultSchema>;

export const automationGenerationCatalogSchema = z.object({
  timezone: z.string().min(1),
  emailTemplates: z.array(automationResourceOptionSchema).max(1_000),
  forms: z.array(automationResourceOptionSchema).max(1_000),
  segments: z.array(automationResourceOptionSchema).max(1_000),
  tags: z.array(automationResourceOptionSchema).max(1_000),
  webhookEndpoints: z.array(automationResourceOptionSchema).max(1_000),
  subscriptionTopics: z.array(automationResourceOptionSchema).max(1_000),
});
export type AutomationGenerationCatalog = z.infer<typeof automationGenerationCatalogSchema>;

export const automationDesignerInitialDataSchema = z.object({
  request: generateAutomationInputSchema,
  catalog: automationGenerationCatalogSchema,
  trustedBrief: z.unknown().optional(),
});
export type AutomationDesignerInitialData = z.infer<typeof automationDesignerInitialDataSchema>;
