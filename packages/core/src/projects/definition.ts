import * as z from "zod";

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

export const PROJECT_BRIEF_DOCUMENT_SCHEMA_VERSION = 1 as const;

/**
 * The version marker deliberately lives beside the legacy definition fields.
 * The legacy object schema strips that one unknown key, so a migration-first
 * rolling deploy remains readable by both the old and new server.
 */
export const projectBriefDocumentV1Schema = marketingAutomationBriefDefinitionSchema
  .extend({
    schemaVersion: z.literal(PROJECT_BRIEF_DOCUMENT_SCHEMA_VERSION),
  })
  .strict();
export type ProjectBriefDocumentV1 = z.infer<typeof projectBriefDocumentV1Schema>;

/**
 * Reads both the canonical versioned document and the legacy naked definition.
 * All successful parses return the canonical v1 document so persistence code
 * can rewrite legacy values without leaking two shapes into the application.
 */
export const projectBriefDocumentSchema = z.preprocess((value) => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Object.prototype.hasOwnProperty.call(value, "schemaVersion")
  ) {
    return {
      ...(value as Record<string, unknown>),
      schemaVersion: PROJECT_BRIEF_DOCUMENT_SCHEMA_VERSION,
    };
  }
  return value;
}, projectBriefDocumentV1Schema);
export type ProjectBriefDocument = z.infer<typeof projectBriefDocumentSchema>;

export function upcastProjectBriefDocument(value: unknown): ProjectBriefDocument {
  return projectBriefDocumentSchema.parse(value);
}

export function definitionFromProjectBriefDocument(
  value: ProjectBriefDocument,
): MarketingAutomationBriefDefinition {
  const { schemaVersion: _schemaVersion, ...definition } = value;
  return marketingAutomationBriefDefinitionSchema.parse(definition);
}

const projectBriefDraftBaseSchema = z.object({
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

export const projectBriefDraftInputSchema = projectBriefDraftBaseSchema.refine(
  (input) => input.ownerUserId !== input.approverUserId,
  {
    path: ["approverUserId"],
    message: "担当者と承認者には異なるメンバーを指定してください",
  },
);
export type ProjectBriefDraftInput = z.infer<typeof projectBriefDraftInputSchema>;

/** Agent proposals leave assignment to the human applying the draft. */
export const projectBriefGeneratedDraftSchema = projectBriefDraftBaseSchema.omit({
  ownerUserId: true,
  approverUserId: true,
});

/** @deprecated Use projectBriefDraftInputSchema. */
export const projectBriefMutationSchema = projectBriefDraftInputSchema;
/** @deprecated Use ProjectBriefDraftInput. */
export type ProjectBriefMutation = ProjectBriefDraftInput;
