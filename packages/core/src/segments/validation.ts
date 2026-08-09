import * as z from "zod";

import { segmentFilterSchema } from "./schema.js";

export const segmentValidationIssueSchema = z.object({
  phase: z.enum(["schema", "resource"]),
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
});
export type SegmentValidationIssue = z.infer<typeof segmentValidationIssueSchema>;

export const segmentValidationResultSchema = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(true), normalized: segmentFilterSchema, issues: z.tuple([]) }),
  z.object({ valid: z.literal(false), issues: z.array(segmentValidationIssueSchema).min(1) }),
]);
export type SegmentValidationResult = z.infer<typeof segmentValidationResultSchema>;
