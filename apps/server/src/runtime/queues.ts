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
export type DeliveryQueueMessage = z.infer<typeof deliveryQueueMessageSchema>;

export const contactImportQueueMessageSchema = z.object({
  kind: z.literal("contact_import"),
  importJobId: z.string(),
  part: z.number().int().nonnegative(),
  totalParts: z.number().int().positive(),
});
export type ContactImportQueueMessage = z.infer<typeof contactImportQueueMessageSchema>;

export const contactExportQueueMessageSchema = z.object({
  kind: z.literal("contact_export"),
  exportJobId: z.string(),
});
export type ContactExportQueueMessage = z.infer<typeof contactExportQueueMessageSchema>;

export const contactEventQueueMessageSchema = z.object({
  kind: z.literal("contact_event"),
  eventId: z.string().min(1),
});
export type ContactEventQueueMessage = z.infer<typeof contactEventQueueMessageSchema>;

export const segmentContactReconcileQueueMessageSchema = z.object({
  kind: z.literal("segment_contact_reconcile"),
  workspaceId: z.string().min(1),
  contactId: z.string().min(1),
});
export type SegmentContactReconcileQueueMessage = z.infer<
  typeof segmentContactReconcileQueueMessageSchema
>;

export const segmentFullRefreshQueueMessageSchema = z.object({
  kind: z.literal("segment_full_refresh"),
  workspaceId: z.string().min(1),
  segmentId: z.string().min(1),
  filterVersion: z.number().int().positive(),
});
export type SegmentFullRefreshQueueMessage = z.infer<typeof segmentFullRefreshQueueMessageSchema>;

/** Everything the jobs queue carries, dispatched on the kind discriminator. */
export const jobsQueueMessageSchema = z.discriminatedUnion("kind", [
  automationJobQueueMessageSchema,
  contactEventQueueMessageSchema,
  contactImportQueueMessageSchema,
  contactExportQueueMessageSchema,
  segmentContactReconcileQueueMessageSchema,
  segmentFullRefreshQueueMessageSchema,
]);

export type JobsQueueMessage = z.infer<typeof jobsQueueMessageSchema>;

export type QueueMessage =
  | AutomationJobQueueMessage
  | DeliveryQueueMessage
  | ContactEventQueueMessage
  | ContactImportQueueMessage
  | ContactExportQueueMessage
  | SegmentContactReconcileQueueMessage
  | SegmentFullRefreshQueueMessage;
