import type { Hono } from "hono";

import { PublicFormRepository } from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { logError } from "../observability";
import type { JobsQueueMessage } from "../runtime/queues";
import { hasTurnstileConfiguration } from "../web/config";
import { safeJson } from "./http";
import { SubmitPublicFormUseCase } from "./submit-form-use-case";
import { formEmbedScript, renderPublicForm } from "./templates";

export function registerPublicFormRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/forms/:workspaceSlug/:formSlug/embed.js", async (context) => {
    const form = await new PublicFormRepository(context.get("database")).findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    if (form.turnstileEnabled && !hasTurnstileConfiguration(context.env)) {
      return apiError(context, 503, "turnstile_not_configured", "Turnstileが設定されていません");
    }
    let style = "inline";
    if (
      ["inline", "floating-bar", "floating-box", "modal"].includes(String(form.definition["style"]))
    ) {
      style = String(form.definition["style"]);
    }
    const formUrl = new URL(
      `/f/${context.req.param("workspaceSlug")}/${context.req.param("formSlug")}`,
      context.req.url,
    ).toString();
    return new Response(
      formEmbedScript(formUrl, form.name, style, context.req.param("workspaceSlug")),
      {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  });

  publicApp.get("/f/:workspaceSlug/:formSlug", async (context) => {
    const form = await new PublicFormRepository(context.get("database")).findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    if (form.turnstileEnabled && !hasTurnstileConfiguration(context.env)) {
      return apiError(context, 503, "turnstile_not_configured", "Turnstileが設定されていません");
    }
    const domains = form.allowedDomains;
    const frameAncestors =
      domains.length > 0
        ? domains.flatMap((domain) => [
            `https://${domain}`,
            `https://*.${domain}`,
            `http://${domain}`,
            `http://*.${domain}`,
          ])
        : ["https:", "http:"];
    const turnstileSource = form.turnstileEnabled ? " https://challenges.cloudflare.com" : "";
    context.header(
      "Content-Security-Policy",
      `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSource}; connect-src 'self'${turnstileSource}; frame-src 'self'${turnstileSource}; frame-ancestors 'self' ${frameAncestors.join(" ")}`,
    );
    // `oe_v` is stamped by the embed script from the same localStorage key the
    // tracking beacon writes, so a returning visitor is recognised here.
    const visitorId = context.req.query("oe_v");
    const answered = visitorId
      ? await new PublicFormRepository(context.get("database")).findAnsweredFieldsByVisitor(
          form.workspaceId,
          visitorId,
        )
      : undefined;
    return context.html(
      renderPublicForm(form.name, form.definition, context.req.url, {
        ...(answered ? { answered } : {}),
        ...(visitorId ? { visitorId } : {}),
        ...(form.turnstileEnabled && context.env.TURNSTILE_SITE_KEY
          ? { turnstileSiteKey: context.env.TURNSTILE_SITE_KEY }
          : {}),
      }),
    );
  });

  publicApp.post("/f/:workspaceSlug/:formSlug", async (context) => {
    const body = await safeJson(context);
    const result = await new SubmitPublicFormUseCase(context.get("database"), context.env).execute({
      workspaceSlug: context.req.param("workspaceSlug"),
      formSlug: context.req.param("formSlug"),
      body,
      origin: context.req.header("origin"),
      requestHostname: new URL(context.req.url).hostname,
      connectingIp: context.req.header("cf-connecting-ip"),
      idempotencyKeyHeader: context.req.header("idempotency-key"),
    });

    switch (result.kind) {
      case "form_not_found":
        return apiError(context, 404, "form_not_found", "フォームが見つかりません");
      case "turnstile_not_configured":
        return apiError(context, 503, "turnstile_not_configured", "Turnstileが設定されていません");
      case "origin_denied":
        return apiError(context, 403, "form_origin_denied", "このドメインからは送信できません");
      case "invalid_payload":
        return apiError(context, 422, "invalid_payload", "入力が不正です");
      case "honeypot":
        return context.json({ data: { accepted: true } }, 202);
      case "idempotency_key_required":
        return apiError(context, 422, "idempotency_key_required", "Idempotency-Keyが必要です");
      case "duplicate":
        return context.json({ data: { accepted: true, duplicate: true } }, 202);
      case "invalid_form_fields":
        return apiError(context, 422, "invalid_form_fields", "入力項目が不正です", {
          fields: result.fields,
        });
      case "turnstile_failed":
        return apiError(context, 422, "turnstile_failed", "Turnstile検証に失敗しました");
      case "accepted":
        break;
    }

    const messages = result.eventIds.map((eventId) => ({
      body: { kind: "contact_event" as const, eventId } satisfies JobsQueueMessage,
    }));
    try {
      context.executionCtx.waitUntil(
        context.env.JOBS_QUEUE.sendBatch(messages).catch((error) => {
          logError("public_form.event_enqueue_failed", error, {
            workspaceId: result.workspaceId,
            formId: result.formId,
            eventIds: result.eventIds,
          });
        }),
      );
    } catch (error) {
      // A custom Queue implementation can throw before returning its promise.
      // Persistence is already committed, so scheduled outbox recovery remains authoritative.
      logError("public_form.event_enqueue_failed", error, {
        workspaceId: result.workspaceId,
        formId: result.formId,
        eventIds: result.eventIds,
      });
    }
    return context.json({ data: { accepted: true, message: result.successMessage } }, 202);
  });
}
