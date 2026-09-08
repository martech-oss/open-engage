import type { Hono } from "hono";

import { PublicFormHandlerRepository, PublicFormRepository } from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { logError } from "../observability";
import { originAllowed } from "../web/domain";
import { SubmitPublicFormUseCase } from "./submit-form-use-case";

export function registerPublicFormHandlerRoutes(app: Hono<AppEnvironment>) {
  app.options("/fh/:workspaceSlug/:handlerSlug", async (context) => {
    const handler = await new PublicFormHandlerRepository(context.get("database")).find(
      context.req.param("workspaceSlug"),
      context.req.param("handlerSlug"),
    );
    const origin = context.req.header("origin");
    if (!handler || !origin || !originAllowed(origin, handler.allowedDomains))
      return apiError(context, 403, "origin_denied", "このドメインからは送信できません");
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    context.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    context.header("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
    return context.body(null, 204);
  });
  app.post("/fh/:workspaceSlug/:handlerSlug", async (context) => {
    const database = context.get("database"),
      workspaceSlug = context.req.param("workspaceSlug");
    const handler = await new PublicFormHandlerRepository(database).find(
      workspaceSlug,
      context.req.param("handlerSlug"),
    );
    if (!handler)
      return apiError(context, 404, "handler_not_found", "Form Handlerが見つかりません");
    const origin = context.req.header("origin");
    if (!origin || !originAllowed(origin, handler.allowedDomains))
      return apiError(context, 403, "origin_denied", "このドメインからは送信できません");
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    const form = await new PublicFormRepository(database).findPublishedForm(
      workspaceSlug,
      handler.formSlug,
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    const json = context.req.header("content-type")?.includes("application/json") === true;
    let raw: Record<string, unknown>;
    try {
      raw = json
        ? await context.req.json<Record<string, unknown>>()
        : Object.fromEntries(await context.req.raw.formData());
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid body");
    } catch {
      return json
        ? apiError(context, 422, "invalid_payload", "入力が不正です")
        : context.redirect(handler.failureUrl, 303);
    }
    const body: Record<string, unknown> = {};
    const custom = new Set(
      form.definition.fields?.filter((field) => field.kind === "custom").map((field) => field.key),
    );
    for (const [source, target] of Object.entries(handler.fieldMapping))
      if (source in raw) body[custom.has(target) ? `custom:${target}` : target] = raw[source];
    for (const key of [
      "_website",
      "idempotencyKey",
      "turnstileToken",
      "cf-turnstile-response",
      "oe_v",
      "consent",
      "measurementToken",
    ])
      if (key in raw) body[key] = raw[key];
    if (!json && body["consent"] === "true") body["consent"] = true;
    const result = await new SubmitPublicFormUseCase(database, context.env).execute({
      workspaceSlug,
      formSlug: handler.formSlug,
      resolvedForm: { ...form, allowedDomains: handler.allowedDomains },
      body,
      origin,
      requestHostname: new URL(context.req.url).hostname,
      connectingIp: context.req.header("cf-connecting-ip"),
      idempotencyKeyHeader: context.req.header("idempotency-key"),
    });
    const accepted =
      result.kind === "accepted" || result.kind === "duplicate" || result.kind === "honeypot";
    if (result.kind === "accepted") {
      const messages = result.eventIds.map((eventId) => ({
        body: { kind: "contact_event" as const, eventId },
      }));
      try {
        context.executionCtx.waitUntil(
          context.env.JOBS_QUEUE.sendBatch(messages).catch((error) =>
            logError("form_handler.event_enqueue_failed", error, { formId: form.id }),
          ),
        );
        if (result.visitorId)
          context.executionCtx.waitUntil(
            context.env.JOBS_QUEUE.send({
              kind: "visitor_history",
              workspaceId: result.workspaceId,
              visitorId: result.visitorId,
            }).catch((error) =>
              logError("form_handler.history_enqueue_failed", error, { formId: form.id }),
            ),
          );
      } catch (error) {
        logError("form_handler.event_enqueue_failed", error, { formId: form.id });
      }
    }
    if (!json) return context.redirect(accepted ? handler.successUrl : handler.failureUrl, 303);
    if (!accepted)
      return apiError(
        context,
        result.kind === "idempotency_conflict" ? 409 : 422,
        result.kind,
        "入力内容を確認してください",
        result.kind === "invalid_form_fields" ? { fields: result.fields } : undefined,
      );
    return context.json(
      {
        data: {
          accepted: true,
          duplicate: result.kind === "duplicate",
          ...("visitorToken" in result && result.visitorToken
            ? { visitorToken: result.visitorToken }
            : {}),
        },
      },
      202,
    );
  });
}
