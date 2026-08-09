import * as z from "zod";

import {
  emailBrandProfileSchema,
  emailDocumentV2Schema,
  emailHrefSchema,
  emailPurposeSchema,
} from "../messaging/index.js";
import { validateAutomation, type AutomationValidationIssue } from "./automation.js";
import { automationGenerationCatalogSchema, automationResourceKindSchema } from "./generation.js";
import { automationDefinitionSchema, emailSequenceTypeSchema } from "./schema.js";

export const emailSequenceCapabilitySchema = z.enum([
  "transactional-compatible",
  "delivery-capability-blocked",
]);
export type EmailSequenceCapability = z.infer<typeof emailSequenceCapabilitySchema>;

const textRequestKindSchema = z.enum(["cta_url", "event_name", "claim", "offer"]);

export const emailSequenceInputRequestSchema = z.discriminatedUnion("inputType", [
  z.object({
    requestId: z.string().trim().min(1).max(80),
    inputType: z.literal("resource"),
    kind: automationResourceKindSchema,
    label: z.string().trim().min(1).max(191),
    reason: z.string().trim().min(1).max(1_000),
    required: z.boolean(),
  }),
  z.object({
    requestId: z.string().trim().min(1).max(80),
    inputType: z.literal("text"),
    kind: textRequestKindSchema,
    label: z.string().trim().min(1).max(191),
    reason: z.string().trim().min(1).max(1_000),
    required: z.boolean(),
  }),
]);
export type EmailSequenceInputRequest = z.infer<typeof emailSequenceInputRequestSchema>;

export const emailSequenceContinuationSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  plannedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  requests: z.array(emailSequenceInputRequestSchema).min(1).max(100),
});
export type EmailSequenceContinuation = z.infer<typeof emailSequenceContinuationSchema>;

export const emailSequenceResolutionSchema = z.discriminatedUnion("decision", [
  z.object({
    requestId: z.string().trim().min(1).max(80),
    decision: z.literal("select"),
    resourceId: z.string().min(1),
  }),
  z.object({
    requestId: z.string().trim().min(1).max(80),
    decision: z.literal("provide"),
    value: z.string().trim().min(1).max(2_000),
  }),
  z.object({ requestId: z.string().trim().min(1).max(80), decision: z.literal("omit") }),
]);
export type EmailSequenceResolution = z.infer<typeof emailSequenceResolutionSchema>;

const sequenceCtaSchema = z.object({
  label: z.string().trim().min(1).max(200),
  href: emailHrefSchema,
});

const sequenceVariableSchema = z.object({
  key: z.string().trim().min(1).max(191),
  source: z.string().trim().min(1).max(500),
});

export const emailSequenceEmailSchema = z
  .object({
    emailRef: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{0,79}$/),
    templateId: z.string().min(1),
    name: z.string().trim().min(1).max(191),
    purpose: emailPurposeSchema,
    purposeDescription: z.string().trim().min(1).max(1_000),
    subjectOptions: z.array(z.string().trim().min(1).max(998)).min(2).max(3),
    selectedSubject: z.string().trim().min(1).max(998),
    content: emailDocumentV2Schema,
    cta: sequenceCtaSchema.nullable(),
    timing: z.string().trim().min(1).max(500),
    recipientCondition: z.string().trim().min(1).max(1_000),
    skipCondition: z.string().trim().min(1).max(1_000),
    variables: z.array(sequenceVariableSchema).max(100),
    topicId: z.string().min(1).nullable(),
    classificationReason: z.string().trim().min(1).max(1_000),
  })
  .superRefine((email, context) => {
    if (!email.subjectOptions.includes(email.selectedSubject)) {
      context.addIssue({
        code: "custom",
        path: ["selectedSubject"],
        message: "選択中の件名は件名候補に含まれている必要があります",
      });
    }
    if (email.purpose === "marketing" && !email.topicId) {
      context.addIssue({
        code: "custom",
        path: ["topicId"],
        message: "Marketingメールには購読トピックが必要です",
      });
    }
  });
export type EmailSequenceEmail = z.infer<typeof emailSequenceEmailSchema>;

const emailSequenceOverviewSchema = z.object({
  name: z.string().trim().min(1).max(191),
  type: emailSequenceTypeSchema,
  outcome: z.string().trim().min(1).max(2_000),
  audience: z.string().trim().min(1).max(2_000),
  entry: z.string().trim().min(1).max(1_000),
  conversionExit: z.string().trim().min(1).max(1_000),
  cadence: z.string().trim().min(1).max(1_000),
  reentry: z.enum(["once", "every_time"]),
  consent: z.string().trim().min(1).max(1_000),
  suppression: z.string().trim().min(1).max(1_000),
});

const measurementSchema = z.object({
  primaryOutcome: z.string().trim().min(1).max(500),
  earlySignal: z.string().trim().min(1).max(500),
  baseline: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(500),
  firstMeasurementWindow: z.string().trim().min(1).max(500),
  events: z.array(z.string().trim().min(1).max(500)).max(50),
});

export const emailSequenceProposalSchema = z.object({
  proposalId: z.string().min(1),
  automationId: z.string().min(1),
  summary: z.string().trim().min(1).max(2_000),
  overview: emailSequenceOverviewSchema,
  emails: z.array(emailSequenceEmailSchema).min(2).max(8),
  definition: automationDefinitionSchema,
  capabilityState: emailSequenceCapabilitySchema,
  measurement: measurementSchema,
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
});
export type EmailSequenceProposal = z.infer<typeof emailSequenceProposalSchema>;

const generationRequestBaseSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  continuation: emailSequenceContinuationSchema.optional(),
  resolutions: z.array(emailSequenceResolutionSchema).max(100).optional(),
});

export const generateEmailSequenceInputSchema = z.discriminatedUnion("mode", [
  generationRequestBaseSchema.extend({ mode: z.literal("create") }),
  generationRequestBaseSchema.extend({
    mode: z.literal("refine"),
    currentProposal: emailSequenceProposalSchema,
  }),
]);
export type GenerateEmailSequenceInput = z.infer<typeof generateEmailSequenceInputSchema>;

const needsInputBaseSchema = z.object({
  status: z.literal("needs_input"),
  summary: z.string().trim().min(1).max(2_000),
  plannedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
});

export const emailSequenceAgentResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), proposal: emailSequenceProposalSchema }),
  needsInputBaseSchema.extend({
    requests: z.array(emailSequenceInputRequestSchema).min(1).max(100),
  }),
]);
export type EmailSequenceAgentResult = z.infer<typeof emailSequenceAgentResultSchema>;

export const emailSequenceGenerationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), proposal: emailSequenceProposalSchema }),
  needsInputBaseSchema.extend({
    continuation: emailSequenceContinuationSchema,
    requests: z
      .array(
        z.intersection(
          emailSequenceInputRequestSchema,
          z.object({
            options: z
              .array(
                z.object({
                  id: z.string().min(1),
                  name: z.string().trim().min(1).max(191),
                  description: z.string().trim().max(500).optional(),
                }),
              )
              .max(1_000),
          }),
        ),
      )
      .min(1)
      .max(100),
  }),
]);
export type EmailSequenceGenerationResult = z.infer<typeof emailSequenceGenerationResultSchema>;

export const applyEmailSequenceInputSchema = emailSequenceProposalSchema;
export const applyEmailSequenceResultSchema = z.object({
  automationId: z.string(),
  draftVersionId: z.string(),
  templates: z.array(z.object({ emailRef: z.string(), templateId: z.string() })),
  capabilityState: emailSequenceCapabilitySchema,
});
export type ApplyEmailSequenceResult = z.infer<typeof applyEmailSequenceResultSchema>;

export interface EmailSequenceValidationIssue {
  code: "graph" | "duplicate_ref" | "duplicate_template" | "template_reference" | "capability";
  message: string;
  emailRef?: string;
  nodeId?: string;
}

export function capabilityForSequence(
  emails: ReadonlyArray<Pick<EmailSequenceEmail, "purpose">>,
): EmailSequenceCapability {
  return emails.some((email) => email.purpose === "marketing")
    ? "delivery-capability-blocked"
    : "transactional-compatible";
}

export function validateEmailSequenceProposal(
  proposal: EmailSequenceProposal,
): EmailSequenceValidationIssue[] {
  const issues: EmailSequenceValidationIssue[] = validateAutomation(proposal.definition).map(
    (issue: AutomationValidationIssue) => ({
      code: "graph" as const,
      message: issue.message,
      ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
    }),
  );
  const refs = new Set<string>();
  const templateIds = new Set<string>();
  for (const email of proposal.emails) {
    if (refs.has(email.emailRef)) {
      issues.push({
        code: "duplicate_ref",
        message: `Duplicate emailRef: ${email.emailRef}`,
        emailRef: email.emailRef,
      });
    }
    if (templateIds.has(email.templateId)) {
      issues.push({
        code: "duplicate_template",
        message: `Duplicate templateId: ${email.templateId}`,
        emailRef: email.emailRef,
      });
    }
    refs.add(email.emailRef);
    templateIds.add(email.templateId);
  }
  const referenced = new Set(
    proposal.definition.nodes.flatMap((node) =>
      node.type === "action" && node.config.action === "send_email" ? [node.config.templateId] : [],
    ),
  );
  const referenceCounts = new Map<string, number>();
  for (const node of proposal.definition.nodes) {
    if (node.type !== "action" || node.config.action !== "send_email") continue;
    const config = node.config;
    referenceCounts.set(config.templateId, (referenceCounts.get(config.templateId) ?? 0) + 1);
    const email = proposal.emails.find((candidate) => candidate.templateId === config.templateId);
    if (email && (config.topicId ?? null) !== email.topicId) {
      issues.push({
        code: "template_reference",
        message: `Node ${node.id} does not use the consent topic declared by ${email.emailRef}`,
        nodeId: node.id,
        emailRef: email.emailRef,
      });
    }
  }
  for (const templateId of templateIds) {
    if (!referenced.has(templateId) || referenceCounts.get(templateId) !== 1) {
      issues.push({
        code: "template_reference",
        message: `Email template ${templateId} must be referenced by exactly one send_email node`,
      });
    }
  }
  for (const node of proposal.definition.nodes) {
    if (
      node.type === "action" &&
      node.config.action === "send_email" &&
      !templateIds.has(node.config.templateId)
    ) {
      issues.push({
        code: "template_reference",
        message: `Node ${node.id} references a template outside the sequence bundle`,
        nodeId: node.id,
      });
    }
  }
  if (capabilityForSequence(proposal.emails) !== proposal.capabilityState) {
    issues.push({ code: "capability", message: "Sequence capability state is inconsistent" });
  }
  const metadata = proposal.definition.metadata;
  if (
    !metadata ||
    metadata.origin !== "email_sequence" ||
    metadata.sequenceType !== proposal.overview.type ||
    metadata.outcome !== proposal.overview.outcome ||
    metadata.primaryMetric !== proposal.measurement.primaryOutcome ||
    metadata.earlySignal !== proposal.measurement.earlySignal
  ) {
    issues.push({
      code: "graph",
      message: "Automation metadata must match the sequence overview and measurement plan",
    });
  }
  return issues;
}

export const emailSequenceDesignerInitialDataSchema = z.object({
  request: generateEmailSequenceInputSchema,
  catalog: automationGenerationCatalogSchema,
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
  reserved: z.object({
    proposalId: z.string().min(1),
    automationId: z.string().min(1),
    templateIds: z.array(z.string().min(1)).length(8),
  }),
});
