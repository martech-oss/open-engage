import * as z from "zod";

import { normalizeSlug } from "../shared/schema";
import { contentDocumentSchema } from "./content";

export const publishStatusSchema = z.enum(["draft", "published"]);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

export const STANDARD_FORM_FIELD_KEYS = ["email", "firstName", "lastName", "phone"] as const;
export const standardFormFieldKeySchema = z.enum(STANDARD_FORM_FIELD_KEYS);
export type StandardFormFieldKey = z.infer<typeof standardFormFieldKeySchema>;

export const FORM_FIELD_INPUT_TYPES = [
  "email",
  "text",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
] as const;
export const formFieldInputTypeSchema = z.enum(FORM_FIELD_INPUT_TYPES);
export type FormFieldInputType = z.infer<typeof formFieldInputTypeSchema>;

/**
 * `standard` keys map onto contact columns; `custom` keys land in
 * `contacts.custom_fields` under the same key. Definitions written before
 * custom fields existed omit `kind`, so it defaults to `standard`.
 */
export const formFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(191)
    .regex(/^[A-Za-z0-9_-]+$/, "英数字、アンダースコア、ハイフンで入力してください"),
  kind: z.enum(["standard", "custom"]).default("standard"),
  label: z.string().trim().max(191).optional(),
  type: formFieldInputTypeSchema.default("text"),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  /**
   * Progressive Profiling: once the identified visitor already has a value for
   * this field, the form drops it and shows the next unanswered one instead.
   */
  progressive: z.boolean().default(false),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const signupFormDefinitionSchema = z.object({
  style: z.enum(["inline", "floating-bar", "floating-box", "modal"]).optional(),
  fields: z.array(formFieldSchema).max(50).optional(),
  /** Cap on how many progressive fields one visit may ask for. */
  progressiveMaxFields: z.number().int().min(1).max(10).default(3),
});
export type SignupFormDefinition = z.infer<typeof signupFormDefinitionSchema>;

export const signupFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: publishStatusSchema,
  version: z.number().int(),
  definition: signupFormDefinitionSchema,
  allowedDomains: z.array(z.string()),
  turnstileEnabled: z.boolean(),
  successMessage: z.string(),
  submissionCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SignupForm = z.infer<typeof signupFormSchema>;

export const landingPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: publishStatusSchema,
  currentVersionId: z.string().nullable(),
  version: z.number().int().nullable(),
  contentDocument: contentDocumentSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LandingPage = z.infer<typeof landingPageSchema>;

export const siteMessageSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: publishStatusSchema,
  headline: z.string(),
  body: z.string(),
  ctaLabel: z.string(),
  ctaUrl: z.string().nullable(),
  pagePattern: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  impressionCount: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SiteMessage = z.infer<typeof siteMessageSchema>;

export const siteTrackingSchema = z.object({
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
  consentMode: z.literal("required"),
  workspaceSlug: z.string(),
  summary: z.object({
    pageViews: z.number().int().nonnegative(),
    uniqueVisitors: z.number().int().nonnegative(),
    identifiedContacts: z.number().int().nonnegative(),
  }),
  topPages: z.array(z.object({ url: z.string(), views: z.number().int().nonnegative() })),
  recentEvents: z.array(
    z.object({
      visitorId: z.string(),
      contactId: z.string().nullable(),
      resourceId: z.string(),
      properties: z.record(z.string(), z.unknown()),
      occurredAt: z.string(),
    }),
  ),
  updatedAt: z.string().nullable(),
});
export type SiteTracking = z.infer<typeof siteTrackingSchema>;

const normalizedSlugSchema = (fallback: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(191)
    .transform((value) => normalizeSlug(value, { fallback }));

export const signupFormWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: normalizedSlugSchema("signup-form"),
  status: publishStatusSchema.default("draft"),
  definition: signupFormDefinitionSchema,
  allowedDomains: z.array(z.string()).default([]),
  turnstileEnabled: z.boolean().default(true),
  successMessage: z.string().max(500).default("ありがとうございます。"),
});
export type SignupFormWrite = z.infer<typeof signupFormWriteSchema>;
export const signupFormCreateSchema = signupFormWriteSchema.extend({
  slug: normalizedSlugSchema("signup-form").optional(),
});
export type SignupFormCreate = z.infer<typeof signupFormCreateSchema>;

export const landingPageWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: normalizedSlugSchema("landing-page"),
  status: publishStatusSchema.default("draft"),
  content: contentDocumentSchema,
});
export type LandingPageWrite = z.infer<typeof landingPageWriteSchema>;
export const landingPageCreateSchema = landingPageWriteSchema.extend({
  slug: normalizedSlugSchema("landing-page").optional(),
});
export type LandingPageCreate = z.infer<typeof landingPageCreateSchema>;

export const siteMessageScheduleSchema = z
  .object({
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
  })
  .superRefine((schedule, context) => {
    if (
      schedule.startsAt &&
      schedule.endsAt &&
      Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "endsAt must be after startsAt",
      });
    }
  });

export const siteMessageWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  status: publishStatusSchema.default("draft"),
  headline: z.string().trim().min(1).max(191),
  body: z.string().trim().max(2_000),
  ctaLabel: z.string().trim().max(120),
  ctaUrl: z.url().nullable(),
  pagePattern: z.string().trim().min(1).max(500),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
});
export type SiteMessageWrite = z.infer<typeof siteMessageWriteSchema>;

export const siteTrackingWriteSchema = z.object({
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
});
export type SiteTrackingWrite = z.infer<typeof siteTrackingWriteSchema>;

export const customRedirectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  destinationUrl: z.string(),
  clickCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomRedirect = z.infer<typeof customRedirectSchema>;

export const customRedirectWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: normalizedSlugSchema("redirect"),
  /** Only http(s): the public route 302s here, so anything else is an open redirect. */
  destinationUrl: z.url().refine(
    (value) => {
      const protocol = URL.parse(value)?.protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "http(s) のURLを入力してください" },
  ),
});
export type CustomRedirectWrite = z.infer<typeof customRedirectWriteSchema>;
