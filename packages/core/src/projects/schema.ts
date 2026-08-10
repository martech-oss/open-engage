import * as z from "zod";

import { automationGenerationCatalogSchema } from "../automations/generation.js";
import { segmentGenerationCatalogSchema } from "../segments/generation.js";

export const MARKETING_MOTIONS = [
  "acquisition",
  "onboarding",
  "engagement",
  "retention",
  "reactivation",
  "measurement",
] as const;
export const marketingMotionSchema = z.enum(MARKETING_MOTIONS);
export type MarketingMotion = z.infer<typeof marketingMotionSchema>;

export const PROJECT_BRIEF_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "completed",
] as const;
export const projectBriefStatusSchema = z.enum(PROJECT_BRIEF_STATUSES);
export type ProjectBriefStatus = z.infer<typeof projectBriefStatusSchema>;

const operationalText = (maximum = 2_000) => z.string().trim().min(1).max(maximum);
const operationalList = (maximum = 100) => z.array(operationalText(500)).max(maximum);

const metricSchema = z.object({
  name: operationalText(500),
  proof: operationalText(500),
});

const baselineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unknown"),
    discoveryTask: operationalText(500),
  }),
  z.object({
    kind: z.literal("assumption"),
    value: operationalText(500),
    evidenceThatWouldChange: operationalText(500),
  }),
  z.object({
    kind: z.literal("measured"),
    value: operationalText(500),
    source: operationalText(500),
  }),
]);

export const marketingAutomationBriefDefinitionSchema = z.object({
  outcome: operationalText(),
  audience: operationalText(),
  lifecycleMoment: operationalText(1_000),
  confidence: z.enum(["high", "medium", "low"]),
  entryTrigger: operationalText(1_000),
  eligibility: operationalList(),
  exclusions: operationalList(),
  actions: operationalList().min(1).max(25),
  exitCondition: operationalText(1_000),
  failureBehavior: operationalText(1_000),
  consentRequirement: operationalText(1_000),
  suppressionRules: operationalText(1_000),
  frequencyPolicy: operationalText(1_000),
  requiredData: operationalList(),
  requiredEvents: operationalList(),
  requiredContent: operationalList(),
  dependenciesAndApprovals: operationalList(),
  deliveryHorizon: operationalText(500),
  measurement: z.object({
    outcomeMetric: metricSchema,
    earlySignal: metricSchema,
    baseline: baselineSchema,
    successThreshold: operationalText(500),
  }),
  immediateNextSteps: operationalList(3).min(1).max(3),
  notIncluded: operationalList(),
  assumptions: operationalList(50),
  followUpExperiment: z
    .object({
      hypothesis: operationalText(1_000),
      change: operationalText(1_000),
      metric: operationalText(500),
      decisionRule: operationalText(500),
    })
    .nullable()
    .default(null),
});
export type MarketingAutomationBriefDefinition = z.infer<
  typeof marketingAutomationBriefDefinitionSchema
>;

export const projectMemberOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "marketer"]),
});
export type ProjectMemberOption = z.infer<typeof projectMemberOptionSchema>;

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectRow = z.infer<typeof projectRowSchema>;

export const projectBriefSummarySchema = projectRowSchema.extend({
  status: projectBriefStatusSchema,
  revision: z.number().int().positive(),
  primaryMotion: marketingMotionSchema,
  ownerUserId: z.string(),
  ownerName: z.string(),
  approverUserId: z.string(),
  approverName: z.string(),
  reviewAt: z.string(),
});
export type ProjectBriefSummary = z.infer<typeof projectBriefSummarySchema>;

export const projectBriefReviewSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  reviewerUserId: z.string(),
  reviewerName: z.string(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string(),
  createdAt: z.string(),
});
export type ProjectBriefReview = z.infer<typeof projectBriefReviewSchema>;

export const projectBriefAuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorUserId: z.string().nullable(),
  actorName: z.string(),
  createdAt: z.string(),
});
export type ProjectBriefAuditEvent = z.infer<typeof projectBriefAuditEventSchema>;

export const projectResourceTypeSchema = z.enum(["automation", "email", "form", "page", "segment"]);
export type ProjectResourceType = z.infer<typeof projectResourceTypeSchema>;

export const projectLinkedResourceSchema = z.object({
  resourceType: projectResourceTypeSchema,
  resourceId: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  briefRevision: z.number().int().positive().nullable(),
  stale: z.boolean(),
  createdAt: z.string(),
});
export type ProjectLinkedResource = z.infer<typeof projectLinkedResourceSchema>;

export const projectBriefDetailSchema = z.object({
  project: projectBriefSummarySchema,
  definition: marketingAutomationBriefDefinitionSchema,
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  reviews: z.array(projectBriefReviewSchema),
  audit: z.array(projectBriefAuditEventSchema),
  items: z.array(projectLinkedResourceSchema),
});
export type ProjectBriefDetail = z.infer<typeof projectBriefDetailSchema>;

export const projectBriefMutationSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(2_000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#7c3aed"),
  ownerUserId: z.string().min(1),
  approverUserId: z.string().min(1),
  primaryMotion: marketingMotionSchema,
  reviewAt: z.iso.datetime(),
  definition: marketingAutomationBriefDefinitionSchema,
});
export type ProjectBriefMutation = z.infer<typeof projectBriefMutationSchema>;

const marketingBriefGenerationBaseSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
});
export const generateMarketingBriefInputSchema = z.discriminatedUnion("mode", [
  marketingBriefGenerationBaseSchema.extend({ mode: z.literal("create") }),
  marketingBriefGenerationBaseSchema.extend({
    mode: z.literal("refine"),
    current: projectBriefMutationSchema,
  }),
]);
export type GenerateMarketingBriefInput = z.infer<typeof generateMarketingBriefInputSchema>;

const capabilityGapSchema = z.object({
  capability: z.string().trim().min(1).max(191),
  detail: z.string().trim().min(1).max(1_000),
});

export const marketingBriefGenerationResultSchema = z.object({
  proposal: projectBriefMutationSchema.omit({ ownerUserId: true, approverUserId: true }),
  summary: z.string().trim().min(1).max(2_000),
  capabilityGaps: z.array(capabilityGapSchema).max(50),
  assumptions: z.array(operationalText(500)).max(50),
  warnings: z.array(operationalText(500)).max(50),
});
export type MarketingBriefGenerationResult = z.infer<typeof marketingBriefGenerationResultSchema>;

export const marketingBriefDesignerInitialDataSchema = z.object({
  request: generateMarketingBriefInputSchema,
  now: z.iso.datetime(),
  catalog: automationGenerationCatalogSchema,
  segmentCatalog: segmentGenerationCatalogSchema,
  capabilities: z.object({
    marketingEmailDelivery: z.literal(false),
    emailOpenTracking: z.literal(false),
    emailClickTracking: z.literal(false),
    ga4Integration: z.literal(false),
  }),
});
export type MarketingBriefDesignerInitialData = z.infer<
  typeof marketingBriefDesignerInitialDataSchema
>;
