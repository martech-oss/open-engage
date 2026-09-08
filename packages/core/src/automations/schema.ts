import * as z from "zod";

import { typedVariableRefSchema, variableRefSchema } from "../projects/variables";
import { segmentFilterSchema, segmentOperatorSchema, segmentValueSchema } from "../segments/schema";

const automationStatusSchema = z.enum(["draft", "active", "paused", "archived"]);

export const EMAIL_SEQUENCE_TYPES = [
  "onboarding",
  "lead_nurture",
  "re_engagement",
  "win_back",
  "product_launch",
  "event_follow_up",
  "upgrade_upsell",
  "educational_drip",
] as const;
export const emailSequenceTypeSchema = z.enum(EMAIL_SEQUENCE_TYPES);
export type EmailSequenceType = z.infer<typeof emailSequenceTypeSchema>;

export const automationRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: automationStatusSchema,
  triggerSource: z.string().nullable(),
  enrollmentCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type AutomationRow = z.infer<typeof automationRowSchema>;

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now") }),
  z.object({ kind: z.literal("once"), at: z.iso.datetime() }),
  z.object({
    kind: z.literal("daily"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("monthly"),
    day: z.number().int().min(1).max(31),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export const automationAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("segment"), segmentId: z.string().min(1) }),
  z.object({ kind: z.literal("filter"), filter: segmentFilterSchema }),
]);
export type AutomationAudience = z.infer<typeof automationAudienceSchema>;
const reentrySchema = z.enum(["once", "every_time", "cooldown"]);
const cooldownMinutesSchema = z.number().int().positive().max(5_256_000).optional();

const sourceNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("source"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("batch"),
      audience: automationAudienceSchema,
      schedule: automationScheduleSchema,
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("callable"),
      reentry: reentrySchema.default("every_time"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("project_member_joined"),
      projectId: z.string().min(1),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("project_member_progressed"),
      projectId: z.string().min(1),
      reentry: reentrySchema.default("every_time"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("project_member_succeeded"),
      projectId: z.string().min(1),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("segment_joined"),
      segmentId: z.string().min(1),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("form_submitted"),
      formId: z.string().min(1),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("contact_created"),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("api_event"),
      eventName: z.string().trim().min(1).max(120),
      reentry: reentrySchema.default("every_time"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("webhook_event"),
      eventName: z.string().trim().min(1).max(120),
      reentry: reentrySchema.default("every_time"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
    z.object({
      source: z.literal("contact_inactive"),
      days: z.number().int().min(1).max(3_650),
      reentry: reentrySchema.default("once"),
      cooldownMinutes: cooldownMinutesSchema,
    }),
  ]),
});

const actionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("action"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("call_automation"),
      automationId: z.string().min(1),
      mode: z.enum(["await", "async"]),
    }),
    z.object({
      action: z.literal("upsert_project_member"),
      projectId: z.string().min(1),
      statusId: z.string().min(1).optional(),
    }),
    z.object({
      action: z.literal("send_email"),
      templateId: z.string().min(1),
      topicId: z.string().optional(),
    }),
    z.object({ action: z.literal("send_webhook"), endpointId: z.string() }),
    z.object({ action: z.literal("add_tag"), tagId: z.string() }),
    z.object({ action: z.literal("remove_tag"), tagId: z.string() }),
    z.object({ action: z.literal("add_segment"), segmentId: z.string() }),
    z.object({ action: z.literal("remove_segment"), segmentId: z.string() }),
    z.object({
      action: z.literal("handoff_to_sales"),
      ownerUserId: z.string().min(1).optional(),
      groupId: z.string().min(1).optional(),
      preserveOwner: z.boolean().default(true),
      title: z
        .union([z.string().trim().min(1).max(191), typedVariableRefSchema("string")])
        .default("Follow up with qualified lead"),
    }),
    z.object({
      action: z.literal("change_score"),
      amount: z.union([z.number().int(), typedVariableRefSchema("number")]),
      operation: z.enum(["add", "set"]).optional(),
      categoryId: z.string().min(1).optional(),
    }),
    z.object({
      action: z.literal("update_field"),
      field: z.string().min(1).max(191),
      value: z.union([z.string(), z.number(), z.boolean(), z.null(), variableRefSchema]),
    }),
  ]),
});

const predicateSchema = z.object({
  field: z.string().min(1).max(191),
  operator: segmentOperatorSchema,
  value: segmentValueSchema,
});

const conditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.union([z.object({ filter: segmentFilterSchema }), predicateSchema]),
});

const decisionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("decision"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.object({
    event: z.enum([
      "opened",
      "clicked",
      "replied",
      "page_viewed",
      "form_submitted",
      "custom_event",
    ]),
    resourceId: z.string().optional(),
    withinMinutes: z.union([
      z.number().int().positive().max(525_600),
      typedVariableRefSchema("number"),
    ]),
  }),
});

const delayNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("delay"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("relative"),
      minutes: z.union([z.number().int().min(1).max(525_600), typedVariableRefSchema("number")]),
    }),
    z.object({
      mode: z.literal("absolute"),
      at: z.union([z.iso.datetime({ offset: true }), typedVariableRefSchema("datetime")]),
    }),
    z.object({
      mode: z.literal("window"),
      minutes: z.union([z.number().int().min(1).max(525_600), typedVariableRefSchema("number")]),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
    }),
  ]),
});

const automationNodeSchema = z.discriminatedUnion("type", [
  sourceNodeSchema,
  actionNodeSchema,
  conditionNodeSchema,
  decisionNodeSchema,
  delayNodeSchema,
]);
export type AutomationNode = z.infer<typeof automationNodeSchema>;

const automationEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  branch: z.enum(["next", "yes", "no", "timeout"]).default("next"),
});
export type AutomationEdge = z.infer<typeof automationEdgeSchema>;

export const automationDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(2_000).default(""),
  timezone: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Invalid IANA timezone")
    .default("UTC"),
  variableProjectId: z.string().min(1).nullable().optional(),
  metadata: z
    .object({
      origin: z.literal("email_sequence"),
      sequenceType: emailSequenceTypeSchema,
      outcome: z.string().trim().min(1).max(2_000),
      primaryMetric: z.string().trim().min(1).max(500),
      earlySignal: z.string().trim().min(1).max(500),
    })
    .optional(),
  nodes: z
    .array(automationNodeSchema)
    .min(1)
    .max(500)
    .refine(
      (nodes) =>
        nodes.every(
          (node) =>
            node.type !== "source" ||
            node.config.reentry !== "cooldown" ||
            (node.config.cooldownMinutes ?? 0) > 0,
        ),
      "Cooldown requires a positive cooldownMinutes",
    ),
  edges: z.array(automationEdgeSchema).max(1_000),
});
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;

export const automationDraftSchema = z.object({
  graph: automationDefinitionSchema,
  status: automationStatusSchema,
  publishability: z.object({
    publishable: z.boolean(),
    capabilityState: z.enum(["transactional-compatible", "delivery-capability-blocked"]).nullable(),
    issues: z.array(z.string().max(2_000)).max(500),
    templates: z.array(
      z.object({
        nodeId: z.string(),
        templateId: z.string(),
        name: z.string().nullable(),
        purpose: z.enum(["transactional", "marketing"]).nullable(),
        published: z.boolean(),
        archived: z.boolean(),
        publishable: z.boolean(),
        reason: z.string().nullable(),
      }),
    ),
  }),
});
export type AutomationDraft = z.infer<typeof automationDraftSchema>;
