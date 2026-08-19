import * as z from "zod";

const contactFieldsSchema = z.object({
  email: z.email().optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  externalId: z.string().trim().max(191).optional(),
  stage: z.string().trim().min(1).max(80).optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export const contactCreateSchema = contactFieldsSchema.refine(
  (value) => value.email || value.externalId,
  {
    message: "email or externalId is required for a known contact",
  },
);
export type ContactCreate = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = contactFieldsSchema.partial().extend({
  email: z.email().nullable().optional(),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  externalId: z.string().trim().max(191).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;

export const contactSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  visitorId: z.string().nullable(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  externalId: z.string().nullable(),
  stage: z.string(),
  score: z.number().int(),
  /** Thirds of a letter from the D baseline; render with gradeLetter(). */
  gradePoints: z.number().int(),
  status: z.enum(["active", "archived", "anonymous"]),
  archivedAt: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;
