import * as z from "zod";

export const companyDomainSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    "domain must be a hostname such as example.com",
  );

const companyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  domain: companyDomainSchema.optional(),
});

export const companyCreateSchema = companyFieldsSchema;
export type CompanyCreate = z.infer<typeof companyCreateSchema>;

const companyUpdateSchema = companyFieldsSchema.partial().extend({
  domain: companyFieldsSchema.shape.domain.unwrap().nullable().optional(),
});
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;

export const companySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Company = z.infer<typeof companySchema>;

export const companySummarySchema = companySchema.extend({
  contactCount: z.number().int().nonnegative(),
});
export type CompanySummary = z.infer<typeof companySummarySchema>;

/** A contact as listed on an account, with its account-specific role fields. */
const companyContactDtoSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  stage: z.string(),
  score: z.number(),
  status: z.enum(["active", "archived", "anonymous"]),
  title: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type CompanyContactDto = z.infer<typeof companyContactDtoSchema>;

export const companyDetailSchema = companySchema.extend({
  contacts: z.array(companyContactDtoSchema),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;
