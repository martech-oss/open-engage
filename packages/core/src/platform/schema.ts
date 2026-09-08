import * as z from "zod";

export const deadLetterRowSchema = z.object({
  id: z.string(),
  sourceQueue: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "replayed", "discarded"]),
  createdAt: z.string(),
  replayedAt: z.string().nullable(),
});
export type DeadLetterRow = z.infer<typeof deadLetterRowSchema>;

export const operationIssueSchema = z.object({
  id: z.string(),
  kind: z.enum(["schedule_delay", "batch_failure", "call_failure", "clone_failure"]),
  name: z.string(),
  message: z.string(),
  occurredAt: z.string(),
  projectId: z.string().nullable(),
  automationId: z.string().nullable(),
  runId: z.string().nullable(),
  enrollmentId: z.string().nullable(),
});
export type OperationIssue = z.infer<typeof operationIssueSchema>;
export const operationHealthSchema = z.object({
  checkedAt: z.string(),
  issues: z.array(operationIssueSchema),
});
