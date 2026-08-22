import * as z from "zod";

import { contactSchema } from "./contact-schema";

export const contactDataJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["contact_import", "contact_export", "event_archive"]),
  status: z.string(),
  processed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errorManifestKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContactDataJob = z.infer<typeof contactDataJobSchema>;

export const contactTimelineEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type ContactTimelineEvent = z.infer<typeof contactTimelineEventSchema>;

/**
 * Chip shape embedded in contact summaries. The management-row variant with
 * a count lives in resource-schema.ts (tagSchema).
 */
const contactTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
});

const contactCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
});

const contactSummarySchema = contactSchema.extend({
  tags: z.array(contactTagSchema),
  companies: z.array(contactCompanySchema),
});

export type ContactSummary = z.infer<typeof contactSummarySchema>;

export const contactExportFilterSchema = z.object({
  query: z.string().trim().optional(),
  status: z.enum(["active", "archived", "anonymous", "all"]).optional(),
  stage: z.string().optional(),
  tagId: z.string().optional(),
  companyId: z.string().optional(),
  segmentId: z.string().optional(),
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
});
export type ContactExportFilter = z.infer<typeof contactExportFilterSchema>;

export const contactListInputSchema = contactExportFilterSchema.extend({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sort: z.enum(["createdAt", "updatedAt", "score", "name", "email"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export type ContactListInput = z.infer<typeof contactListInputSchema>;

export const contactListResultSchema = z.object({
  items: z.array(contactSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});

export type ContactListResult = z.infer<typeof contactListResultSchema>;
