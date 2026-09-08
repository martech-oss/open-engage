import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  landingGenerationJobSchema,
  landingGenerationRequestSchema,
  landingPageVersionSchema,
  formHandlerSchema,
  formHandlerWriteSchema,
  customRedirectSchema,
  customRedirectWriteSchema,
  landingPageCreateSchema,
  landingPageSchema,
  landingPageWriteSchema,
  signupFormCreateSchema,
  signupFormSchema,
  signupFormWriteSchema,
  siteMessageSchema,
  siteMessageWriteSchema,
  siteTrackingSchema,
  siteTrackingWriteSchema,
} from "@openengage/core/web";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput, notFoundError } from "../shared/schemas";
import { optimizationContract } from "./optimization-contract";

const created = z.object({ id: z.string() });

function notFound<const Code extends string>(code: Code, message: string) {
  return { ...authedErrors, ...notFoundError(code, message) } as const;
}

const redirectNotFound = notFound("REDIRECT_NOT_FOUND", "リンクが見つかりません");
const redirectSlugTaken = {
  REDIRECT_SLUG_TAKEN: { status: 409, message: "同じスラッグのリンクが既に存在します" },
} as const;
const turnstileNotConfigured = {
  TURNSTILE_NOT_CONFIGURED: {
    status: 422,
    message: "Turnstileを有効にするにはサイトキーとシークレットが必要です",
  },
} as const;
const invalidSiteMessageSchedule = {
  SITE_MESSAGE_SCHEDULE_INVALID: {
    status: 422,
    message: "終了日時は開始日時より後にしてください",
  },
} as const;

const pageDesignErrors = {
  ...notFound("PAGE_NOT_FOUND", "ページが見つかりません"),
  PAGE_CONFLICT: { status: 409, message: "下書きが更新されています。最新の版を読み込んでください" },
  PAGE_INVALID: { status: 422, message: "ページの参照または設定を確認してください" },
} as const;

const handlerErrors = {
  ...notFound("HANDLER_NOT_FOUND", "Form Handlerが見つかりません"),
  HANDLER_INVALID: { status: 422, message: "マッピング、ドメイン、遷移先を確認してください" },
  HANDLER_SLUG_TAKEN: { status: 409, message: "スラッグが使用されています" },
} as const;

export const websiteContract = {
  listFormHandlers: oc
    .route({ method: "GET", path: "/website/form-handlers" })
    .errors(workspaceErrors)
    .output(z.array(formHandlerSchema)),
  createFormHandler: oc
    .route({ method: "POST", path: "/website/form-handlers", successStatus: 201 })
    .errors(handlerErrors)
    .input(formHandlerWriteSchema)
    .output(created),
  updateFormHandler: oc
    .route({ method: "PATCH", path: "/website/form-handlers/{id}" })
    .errors(handlerErrors)
    .input(formHandlerWriteSchema.extend({ id: z.string() }))
    .output(ackSchema),
  deleteFormHandler: oc
    .route({ method: "DELETE", path: "/website/form-handlers/{id}" })
    .errors(handlerErrors)
    .input(idInput)
    .output(ackSchema),
  ...optimizationContract,
  getPageDesign: oc
    .route({ method: "GET", path: "/website/pages/{id}/design" })
    .errors(pageDesignErrors)
    .input(idInput)
    .output(
      z.object({
        name: z.string(),
        slug: z.string(),
        versions: z.array(landingPageVersionSchema),
        jobs: z.array(landingGenerationJobSchema),
        previewHtml: z.string(),
        currentVersionId: z.string().nullable(),
        publishedVersionId: z.string().nullable(),
      }),
    ),
  generatePage: oc
    .route({ method: "POST", path: "/website/pages/{pageId}/generate", successStatus: 202 })
    .errors(pageDesignErrors)
    .input(landingGenerationRequestSchema)
    .output(landingGenerationJobSchema),
  publishPage: oc
    .route({ method: "POST", path: "/website/pages/{id}/publish" })
    .errors(pageDesignErrors)
    .input(z.object({ id: z.string(), versionId: z.string(), baseVersionId: z.string() }))
    .output(ackSchema),
  issueIdentityToken: oc
    .route({ method: "POST", path: "/website/identity-tokens" })
    .errors({ ...authedErrors, ...notFoundError("CONTACT_NOT_FOUND", "連絡先が見つかりません") })
    .input(z.object({ contactId: z.string().min(1) }))
    .output(z.object({ token: z.string(), expiresInSeconds: z.number() })),
  listForms: oc
    .route({ method: "GET", path: "/website/forms" })
    .errors(workspaceErrors)
    .output(z.array(signupFormSchema)),
  createForm: oc
    .route({ method: "POST", path: "/website/forms", successStatus: 201 })
    .errors({
      ...authedErrors,
      ...turnstileNotConfigured,
      FORM_SLUG_TAKEN: { status: 409, message: "同じスラッグのフォームが既に存在します" },
    })
    .input(signupFormCreateSchema)
    .output(created),
  updateForm: oc
    .route({ method: "PATCH", path: "/website/forms/{id}" })
    .errors({
      ...notFound("FORM_NOT_FOUND", "フォームが見つかりません"),
      ...turnstileNotConfigured,
      FORM_SLUG_TAKEN: { status: 409, message: "同じスラッグのフォームが既に存在します" },
    })
    .input(signupFormWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveForm: oc
    .route({ method: "POST", path: "/website/forms/{id}/archive" })
    .errors(notFound("FORM_NOT_FOUND", "フォームが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  listPages: oc
    .route({ method: "GET", path: "/website/pages" })
    .errors(workspaceErrors)
    .output(z.array(landingPageSchema)),
  createPage: oc
    .route({ method: "POST", path: "/website/pages", successStatus: 201 })
    .errors({
      ...authedErrors,
      PAGE_SLUG_TAKEN: { status: 409, message: "同じスラッグのページが既に存在します" },
      PAGE_INVALID: { status: 422, message: "ページの参照または設定を確認してください" },
    })
    .input(landingPageCreateSchema)
    .output(z.object({ id: z.string(), versionId: z.string() })),
  updatePage: oc
    .route({ method: "PATCH", path: "/website/pages/{id}" })
    .errors({
      ...notFound("PAGE_NOT_FOUND", "ページが見つかりません"),
      PAGE_CONFLICT: { status: 409, message: "下書きが更新されています" },
      PAGE_INVALID: { status: 422, message: "ページの参照または設定を確認してください" },
      PAGE_ARCHIVED: { status: 409, message: "アーカイブ済みページは編集できません" },
      PAGE_SLUG_TAKEN: { status: 409, message: "同じスラッグのページが既に存在します" },
    })
    .input(landingPageWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ id: z.string(), versionId: z.string() })),
  archivePage: oc
    .route({ method: "POST", path: "/website/pages/{id}/archive" })
    .errors(notFound("PAGE_NOT_FOUND", "ページが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  listMessages: oc
    .route({ method: "GET", path: "/website/messages" })
    .errors(workspaceErrors)
    .output(z.array(siteMessageSchema)),
  createMessage: oc
    .route({ method: "POST", path: "/website/messages", successStatus: 201 })
    .errors({ ...authedErrors, ...invalidSiteMessageSchedule })
    .input(siteMessageWriteSchema)
    .output(created),
  updateMessage: oc
    .route({ method: "PATCH", path: "/website/messages/{id}" })
    .errors({
      ...notFound("SITE_MESSAGE_NOT_FOUND", "サイトメッセージが見つかりません"),
      ...invalidSiteMessageSchedule,
    })
    .input(siteMessageWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveMessage: oc
    .route({ method: "POST", path: "/website/messages/{id}/archive" })
    .errors(notFound("SITE_MESSAGE_NOT_FOUND", "サイトメッセージが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  listRedirects: oc
    .route({ method: "GET", path: "/website/redirects" })
    .errors(workspaceErrors)
    .output(z.array(customRedirectSchema)),
  createRedirect: oc
    .route({ method: "POST", path: "/website/redirects", successStatus: 201 })
    .errors({ ...authedErrors, ...redirectSlugTaken })
    .input(customRedirectWriteSchema)
    .output(created),
  updateRedirect: oc
    .route({ method: "PATCH", path: "/website/redirects/{id}" })
    .errors({ ...redirectNotFound, ...redirectSlugTaken })
    .input(customRedirectWriteSchema.extend({ id: z.string().min(1) }))
    .output(ackSchema),
  archiveRedirect: oc
    .route({ method: "POST", path: "/website/redirects/{id}/archive" })
    .errors(redirectNotFound)
    .input(idInput)
    .output(ackSchema),

  getTracking: oc
    .route({ method: "GET", path: "/website/tracking" })
    .errors(workspaceErrors)
    .output(siteTrackingSchema),
  updateTracking: oc
    .route({ method: "PUT", path: "/website/tracking" })
    .errors({
      ...authedErrors,
      INVALID_DOMAIN: { status: 422, message: "有効なドメインを入力してください" },
      TRACKING_DOMAIN_REQUIRED: {
        status: 422,
        message: "トラッキングを有効にするには許可ドメインが必要です",
      },
    })
    .input(siteTrackingWriteSchema)
    .output(ackSchema),
};
