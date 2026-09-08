import * as z from "zod";

import { typedVariableRefSchema, variableSnapshotSchema } from "../projects/variables";
import { signupFormDefinitionSchema } from "./form-schema";

const refId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const safeWebUrlSchema = z
  .string()
  .max(2000)
  .refine((value) => {
    if (/^#[A-Za-z][\w-]*$/.test(value)) return true;
    const url = URL.parse(value);
    return Boolean(
      url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password,
    );
  }, "http(s) URL またはページ内リンクを指定してください");

export const landingPageDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    variableProjectId: z.string().min(1).nullable().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(500),
    html: z.string().max(200_000),
    css: z.string().max(100_000),
    forms: z
      .array(
        z.object({
          refId,
          formId: z.string().min(1).optional(),
          name: z.string().min(1).max(191),
          definition: z.lazy(() => signupFormDefinitionSchema),
          successMessage: z.string().max(500).default("ありがとうございます。"),
          turnstileEnabled: z.boolean().default(true),
        }),
      )
      .max(10),
    ctas: z
      .array(
        z.object({
          refId,
          href: safeWebUrlSchema,
          hrefVariable: typedVariableRefSchema("url").optional(),
          label: z.string().min(1).max(200),
        }),
      )
      .max(30),
    images: z
      .array(z.object({ refId, assetId: z.string().min(1), alt: z.string().max(500) }))
      .max(30),
    dynamicSlots: z.array(z.object({ refId, fallbackHtml: z.string().max(20_000) })).max(20),
    measurement: z.object({
      projectId: z.string().min(1).nullable().default(null),
      primaryConversion: z.literal("form_submitted").default("form_submitted"),
    }),
  })
  .superRefine((doc, context) => {
    const refs = [...doc.forms, ...doc.ctas, ...doc.images, ...doc.dynamicSlots].map(
      (item) => item.refId,
    );
    if (new Set(refs).size !== refs.length)
      context.addIssue({ code: "custom", message: "参照IDはページ全体で一意にしてください" });
  });
export type LandingPageDocument = z.infer<typeof landingPageDocumentSchema>;
export const landingFormBindingSchema = z.object({
  refId,
  formId: z.string(),
  formVersionId: z.string(),
});
export type LandingFormBinding = z.infer<typeof landingFormBindingSchema>;
export const landingPageVersionSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  version: z.number().int(),
  document: landingPageDocumentSchema,
  formBindings: z.array(landingFormBindingSchema),
  publishedDocument: landingPageDocumentSchema.nullable().default(null),
  variableSnapshot: variableSnapshotSchema.nullable().default(null),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type LandingPageVersion = z.infer<typeof landingPageVersionSchema>;
export const landingGenerationRequestSchema = z.object({
  pageId: z.string().min(1),
  baseVersionId: z.string().min(1),
  prompt: z.string().trim().min(1).max(12_000),
  requestKey: z.string().min(1).max(191),
});
export const landingGenerationResultSchema = z.object({
  document: landingPageDocumentSchema,
  explanation: z.string().max(4000),
  imageRequests: z
    .array(z.object({ refId, prompt: z.string().min(1).max(2000), alt: z.string().max(500) }))
    .max(3),
});
export const landingGenerationJobSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  baseVersionId: z.string(),
  prompt: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "conflict"]),
  resultVersionId: z.string().nullable(),
  explanation: z.string().nullable(),
  error: z.string().nullable(),
  failureKind: z.enum(["retryable", "configuration", "conflict"]).nullable().default(null),
  retryable: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const formHandlerWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,190}$/),
  formId: z.string().min(1),
  fieldMapping: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{1,191}$/),
    z.string().regex(/^[A-Za-z0-9_-]{1,191}$/),
  ),
  allowedDomains: z.array(z.string()).min(1).max(30),
  successUrl: safeWebUrlSchema.refine((value) => !value.startsWith("#")),
  failureUrl: safeWebUrlSchema.refine((value) => !value.startsWith("#")),
  enabled: z.boolean().default(true),
});
export const formHandlerSchema = formHandlerWriteSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FormHandlerWrite = z.infer<typeof formHandlerWriteSchema>;

export function emptyLandingPageDocument(title = "新しいページ"): LandingPageDocument {
  return {
    schemaVersion: 1,
    title,
    description: "",
    html: "<main><h1>新しいページ</h1><p>プロンプトを入力してページを作成してください。</p></main>",
    css: "body{font-family:system-ui,sans-serif;margin:0;color:#17202a}main{max-width:70rem;margin:auto;padding:4rem 1.5rem}",
    forms: [],
    ctas: [],
    images: [],
    dynamicSlots: [],
    measurement: { projectId: null, primaryConversion: "form_submitted" },
  };
}
