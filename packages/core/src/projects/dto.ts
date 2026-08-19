import * as z from "zod";

import { marketingAutomationBriefDefinitionSchema, marketingMotionSchema } from "./definition.js";
import {
  marketingCapabilitySnapshotSchema,
  projectBriefAllowedActionsSchema,
  projectBriefStatusSchema,
} from "./workflow.js";

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
  rowVersion: z.number().int().positive(),
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

export const projectResourceTypeSchema = z.enum([
  "automation",
  "email",
  "form",
  "page",
  "redirect",
  "segment",
]);
export type ProjectResourceType = z.infer<typeof projectResourceTypeSchema>;

export const PROJECT_RESOURCE_AVAILABILITIES = ["available", "archived", "missing"] as const;
export const projectResourceAvailabilitySchema = z.enum(PROJECT_RESOURCE_AVAILABILITIES);
export type ProjectResourceAvailability = z.infer<typeof projectResourceAvailabilitySchema>;

export const projectLinkedResourceSchema = z.object({
  resourceType: projectResourceTypeSchema,
  resourceId: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  availability: projectResourceAvailabilitySchema,
  briefRevision: z.number().int().positive().nullable(),
  stale: z.boolean(),
  createdAt: z.string(),
});
export type ProjectLinkedResource = z.infer<typeof projectLinkedResourceSchema>;

export const projectBriefDetailSchema = z.object({
  project: projectBriefSummarySchema,
  rowVersion: z.number().int().positive(),
  definition: marketingAutomationBriefDefinitionSchema,
  capabilities: marketingCapabilitySnapshotSchema,
  allowedActions: projectBriefAllowedActionsSchema,
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  reviews: z.array(projectBriefReviewSchema),
  audit: z.array(projectBriefAuditEventSchema),
  items: z.array(projectLinkedResourceSchema),
});
export type ProjectBriefDetail = z.infer<typeof projectBriefDetailSchema>;
