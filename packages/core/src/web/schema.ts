import * as z from "zod";

import { variableSnapshotSchema } from "../projects/variables";
import { normalizeSlug } from "../shared/schema";
import { contentDocumentSchema } from "./content";
import { signupFormDefinitionSchema } from "./form-schema";
import { landingPageDocumentSchema } from "./landing-document";

export const publishStatusSchema = z.enum(["draft", "published"]);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

export * from "./form-schema";

export const signupFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: publishStatusSchema,
  version: z.number().int(),
  definition: signupFormDefinitionSchema,
  variableProjectId: z.string().min(1).nullable().optional(),
  allowedDomains: z.array(z.string()),
  turnstileEnabled: z.boolean(),
  successMessage: z.string(),
  variableSnapshot: variableSnapshotSchema.nullable().default(null),
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
  publishedVersionId: z.string().nullable().default(null),
  version: z.number().int().nullable(),
  contentDocument: contentDocumentSchema.nullable(),
  document: landingPageDocumentSchema.nullable().default(null),
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
  variableProjectId: z.string().min(1).nullable().optional(),
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
  content: contentDocumentSchema.optional(),
  document: landingPageDocumentSchema.optional(),
  baseVersionId: z.string().optional(),
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
  status: z.enum(["draft", "published"]).default("published"),
  clickCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomRedirect = z.infer<typeof customRedirectSchema>;

export const customRedirectWriteSchema = z.object({
  status: z.enum(["draft", "published"]).default("published"),
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
export type CustomRedirectWrite = z.input<typeof customRedirectWriteSchema>;
