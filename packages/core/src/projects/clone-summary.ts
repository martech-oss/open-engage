import * as z from "zod";

import { projectCloneJobSchema } from "./clone";
/** Read models deliberately omit variable values and frozen resource snapshots. */
export const projectCloneSummarySchema = projectCloneJobSchema
  .pick({
    id: true,
    sourceProjectId: true,
    targetProjectId: true,
    status: true,
    preparedCount: true,
    totalCount: true,
    error: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
  })
  .extend({ name: z.string() });
export type ProjectCloneSummary = z.infer<typeof projectCloneSummarySchema>;
export const projectCloneCursorSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
});
export type ProjectCloneCursor = z.infer<typeof projectCloneCursorSchema>;
export const projectCloneListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: projectCloneCursorSchema.optional(),
});
export const projectClonePageSchema = z.object({
  items: z.array(projectCloneSummarySchema),
  nextCursor: projectCloneCursorSchema.nullable(),
});
export type ProjectClonePage = z.infer<typeof projectClonePageSchema>;
