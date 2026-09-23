import * as z from "zod";

import { companyUpdateSchema } from "./company-dto.js";

export const companyListInputSchema = z.object({
  query: z.string().trim().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type CompanyListInput = z.infer<typeof companyListInputSchema>;

export const companyGetInputSchema = z.object({
  id: z.string().min(1),
});

/** Same field rules as create, so an update cannot store a domain create would reject. */
export const companyUpdateInputSchema = companyUpdateSchema.extend({
  id: z.string().min(1),
});

export const companyAssignContactInputSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  title: z.string().trim().max(191).optional(),
  isPrimary: z.boolean().default(false),
});

export const companyRemoveContactInputSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
});
