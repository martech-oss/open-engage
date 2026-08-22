import { oc } from "@orpc/contract";
import * as z from "zod";

import { emailBrandProfileSchema, emailBrandProfileWriteSchema } from "@openengage/core/messaging";
import { workspaceRoleSchema } from "@openengage/core/shared";
import { webhookEndpointRowSchema, workspaceSchema } from "@openengage/core/workspaces";

import { authedErrors, sessionErrors, workspaceErrors } from "../shared/errors";

export const workspaceContract = {
  create: oc
    .route({ method: "POST", path: "/workspaces", successStatus: 201 })
    .errors(sessionErrors)
    .input(z.object({ name: z.string().trim().min(1).max(191) }))
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
  get: oc
    .route({ method: "GET", path: "/workspace" })
    .errors(workspaceErrors)
    .output(workspaceSchema),
  getEmailBrand: oc
    .route({ method: "GET", path: "/workspace/email-brand" })
    .errors(workspaceErrors)
    .output(emailBrandProfileSchema),
  updateEmailBrand: oc
    .route({ method: "PUT", path: "/workspace/email-brand" })
    .errors({
      ...authedErrors,
      BRAND_LOGO_INVALID: {
        status: 422,
        message: "ロゴには公開中の画像アセットを指定してください",
      },
    })
    .input(emailBrandProfileWriteSchema)
    .output(emailBrandProfileSchema),
  createApiKey: oc
    .route({ method: "POST", path: "/workspace/api-keys", successStatus: 201 })
    .errors(authedErrors)
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        role: workspaceRoleSchema.default("viewer"),
        expiresAt: z.iso.datetime().optional(),
      }),
    )
    .output(z.object({ id: z.string(), token: z.string(), prefix: z.string() })),
  listWebhookEndpoints: oc
    .route({ method: "GET", path: "/workspace/webhooks" })
    .errors(authedErrors)
    .output(z.array(webhookEndpointRowSchema)),
  createWebhookEndpoint: oc
    .route({ method: "POST", path: "/workspace/webhooks", successStatus: 201 })
    .errors({
      ...authedErrors,
      UNSAFE_WEBHOOK_URL: {
        status: 422,
        message: "Webhook URLには公開HTTPSエンドポイントを指定してください",
      },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        url: z.url().startsWith("https://"),
        eventTypes: z.array(z.string().max(120)).max(100).default([]),
      }),
    )
    // The signing secret is shown once and stored encrypted.
    .output(z.object({ id: z.string(), signingSecret: z.string() })),
};
