import * as z from "zod";
export const programMemberImportRowSchema = z.object({
  row: z.number().int(),
  ok: z.boolean(),
  contactId: z.string().optional(),
  error: z.string().optional(),
});
export const programMemberImportSchema = z.object({
  jobId: z.string(),
  status: z.enum(["pending", "running", "completed"]),
  total: z.number().int(),
  processed: z.number().int(),
  rows: z.array(programMemberImportRowSchema),
});
export type ProgramMemberImportRow = z.infer<typeof programMemberImportRowSchema>;
