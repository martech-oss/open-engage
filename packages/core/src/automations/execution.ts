import * as z from "zod";

import { variableSnapshotSchema, type VariableSnapshot } from "../projects/variables";
import { automationDefinitionSchema, type AutomationDefinition } from "./schema";
export interface AutomationExecutionSnapshot {
  graph: AutomationDefinition;
  variableSnapshot: VariableSnapshot | null;
  dependencies: Record<string, AutomationDependency>;
}
export interface AutomationDependency extends AutomationExecutionSnapshot {
  automationId: string;
  versionId: string;
  sourceGraph?: AutomationDefinition | undefined;
}
export const automationExecutionSnapshotSchema: z.ZodType<AutomationExecutionSnapshot> = z.lazy(
  () =>
    z.object({
      graph: automationDefinitionSchema,
      variableSnapshot: variableSnapshotSchema.nullable(),
      dependencies: z.record(z.string(), automationDependencySchema),
    }),
);
export const automationDependencySchema: z.ZodType<AutomationDependency> = z.lazy(() =>
  automationExecutionSnapshotSchema.and(
    z.object({
      automationId: z.string(),
      versionId: z.string(),
      sourceGraph: automationDefinitionSchema.optional(),
    }),
  ),
);
export const automationRunSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  automationId: z.string(),
  automationVersionId: z.string(),
  slot: z.string(),
  status: z.enum(["enrolling", "running", "completed", "cancelled", "failed"]),
  createdAt: z.string(),
  enrollmentCompletedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
  lastError: z.string().nullable(),
  targetCount: z.number(),
  enrolledCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  pendingCount: z.number(),
  flowCompletedCount: z.number(),
  flowFailedCount: z.number(),
  flowActiveCount: z.number(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;
export const automationRunTargetSchema = z.object({
  contactId: z.string(),
  status: z.string(),
  enrollmentId: z.string().nullable(),
  reason: z.string().nullable(),
  lastError: z.string().nullable(),
  attempts: z.number(),
  flowStatus: z.string().nullable(),
});
export const automationRunDetailSchema = z.object({
  run: automationRunSchema,
  targets: z.array(automationRunTargetSchema),
  nextCursor: z.string().nullable(),
});
export const automationEnrollmentDetailSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  automationVersionId: z.string(),
  contactId: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  parentJobId: z.string().nullable(),
  enteredAt: z.string(),
  completedAt: z.string().nullable(),
  jobs: z.array(
    z.object({
      id: z.string(),
      nodeId: z.string(),
      status: z.string(),
      dueAt: z.string(),
      attempts: z.number(),
      lastError: z.string().nullable(),
      payload: z.string(),
    }),
  ),
  children: z.array(
    z.object({
      id: z.string(),
      automationId: z.string(),
      automationVersionId: z.string(),
      status: z.string(),
      parentJobId: z.string().nullable(),
      enteredAt: z.string(),
      completedAt: z.string().nullable(),
    }),
  ),
});
