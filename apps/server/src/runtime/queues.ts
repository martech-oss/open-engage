import * as z from "zod";

export const automationJobQueueMessageSchema = z.object({
  kind: z.literal("automation_job"),
  jobId: z.string(),
  leaseId: z.string(),
});
export type AutomationJobQueueMessage = z.infer<typeof automationJobQueueMessageSchema>;

export const deliveryQueueMessageSchema = z.object({
  kind: z.literal("delivery"),
  deliveryId: z.string(),
});

export const contactImportQueueMessageSchema = z.object({
  kind: z.literal("contact_import"),
  importJobId: z.string(),
  part: z.number().int().nonnegative(),
  totalParts: z.number().int().positive(),
});

export const programMemberImportQueueMessageSchema = z.object({
  kind: z.literal("program_member_import"),
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

export const contactExportQueueMessageSchema = z.object({
  kind: z.literal("contact_export"),
  exportJobId: z.string(),
});

export const contactEventQueueMessageSchema = z.object({
  kind: z.literal("contact_event"),
  eventId: z.string().min(1),
});

export const segmentContactReconcileQueueMessageSchema = z.object({
  kind: z.literal("segment_contact_reconcile"),
  workspaceId: z.string().min(1),
  contactId: z.string().min(1),
});

export const segmentFullRefreshQueueMessageSchema = z.object({
  kind: z.literal("segment_full_refresh"),
  workspaceId: z.string().min(1),
  segmentId: z.string().min(1),
  filterVersion: z.number().int().positive(),
});

export const landingGenerationQueueMessageSchema = z.object({
  kind: z.literal("landing_generation"),
  jobId: z.string().min(1),
});

export const visitorHistoryQueueMessageSchema = z.object({
  kind: z.literal("visitor_history"),
  workspaceId: z.string().min(1),
  visitorId: z.string().min(1),
});

export const scoringDecayQueueMessageSchema = z.object({
  kind: z.literal("scoring_decay"),
  now: z.iso.datetime(),
});

/** Everything the jobs queue carries, dispatched on the kind discriminator. */
export const projectCloneQueueMessageSchema = z.object({
  kind: z.literal("project_clone"),
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});
export const automationRunQueueMessageSchema = z.object({
  kind: z.literal("automation_run"),
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
});
export const automationScheduleQueueMessageSchema = z.object({
  kind: z.literal("automation_schedule"),
  now: z.iso.datetime(),
  afterAutomationId: z.string().min(1),
});

export const jobsQueueMessageSchema = z.discriminatedUnion("kind", [
  projectCloneQueueMessageSchema,
  automationRunQueueMessageSchema,
  automationScheduleQueueMessageSchema,
  visitorHistoryQueueMessageSchema,
  scoringDecayQueueMessageSchema,
  landingGenerationQueueMessageSchema,
  automationJobQueueMessageSchema,
  contactEventQueueMessageSchema,
  contactImportQueueMessageSchema,
  contactExportQueueMessageSchema,
  segmentContactReconcileQueueMessageSchema,
  segmentFullRefreshQueueMessageSchema,
]);

export type JobsQueueMessage = z.infer<typeof jobsQueueMessageSchema>;
