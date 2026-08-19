import type { Hono } from "hono";

import { PublicFormRepository, uuidv7 } from "@openengage/database";

import { apiError } from "../auth/access";
import { processPendingPublicFormEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";
import { logError } from "../observability";
import { isRecord, primitiveString, stringOrNull } from "../platform/values";
import { originAllowed, redactFormPayload } from "./domain";
import { validatePublicFormBody } from "./form-validation";
import { safeJson } from "./http";
import { hashIp, hasTurnstileConfiguration, verifyTurnstile } from "./shared";
import { formEmbedScript, renderPublicForm } from "./templates";

/**
 * The public form namespaces custom inputs as `custom:<key>` so they can never
 * collide with a standard contact column, whatever a marketer names them.
 */
function readCustomFields(body: Record<string, unknown>): Record<string, unknown> {
  const custom: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(body)) {
    if (!name.startsWith("custom:")) continue;
    const key = name.slice("custom:".length);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    const text = typeof value === "string" ? value.trim() : value;
    if (text === "" || text === null || text === undefined) continue;
    custom[key] = text;
  }
  return custom;
}

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
    const database = context.get("database");
    const repository = new PublicFormRepository(database);
    const form = await repository.findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    if (form.turnstileEnabled && !hasTurnstileConfiguration(context.env)) {
      return apiError(context, 503, "turnstile_not_configured", "Turnstileが設定されていません");
    }
    const allowedDomains = form.allowedDomains;
    const origin = context.req.header("origin");
    const requestHostname = new URL(context.req.url).hostname;
    if (
      origin &&
      new URL(origin).hostname !== requestHostname &&
      allowedDomains.length > 0 &&
      !originAllowed(origin, allowedDomains)
    ) {
      return apiError(context, 403, "form_origin_denied", "このドメインからは送信できません");
    }
    const body = await safeJson(context);
    if (!isRecord(body)) return apiError(context, 422, "invalid_payload", "入力が不正です");
    if (body["_website"]) return context.json({ data: { accepted: true } }, 202);
    const visitorId = primitiveString(body["oe_v"]);
    const answered = visitorId
      ? await repository.findAnsweredFieldsByVisitor(form.workspaceId, visitorId)
      : new Set<string>();
    const validationIssues = validatePublicFormBody(form.definition, answered, body);
    if (validationIssues.length > 0) {
      return apiError(context, 422, "invalid_form_fields", "入力項目が不正です", {
        fields: validationIssues,
      });
    }
    if (
      form.turnstileEnabled &&
      !(await verifyTurnstile(
        context.env.TURNSTILE_SECRET ?? "",
        primitiveString(body["cf-turnstile-response"]) || primitiveString(body["turnstileToken"]),
        context.req.header("cf-connecting-ip"),
      ))
    ) {
      return apiError(context, 422, "turnstile_failed", "Turnstile検証に失敗しました");
    }
    const idempotencyKey =
      context.req.header("idempotency-key") ?? primitiveString(body["idempotencyKey"]);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
      return apiError(context, 422, "idempotency_key_required", "Idempotency-Keyが必要です");
    }
    const email = String(body["email"]).trim().toLowerCase();
    const now = new Date().toISOString();
    const contactCreatedEventId = uuidv7();
    const formSubmittedEventId = uuidv7();
    const outcome = await repository.persistSubmission({
      workspaceId: form.workspaceId,
      formId: form.id,
      email,
      idempotencyKey,
      contactFields: {
        firstName: stringOrNull(body["firstName"]),
        lastName: stringOrNull(body["lastName"]),
        phone: stringOrNull(body["phone"]),
        customFields: readCustomFields(body),
      },
      payload: redactFormPayload(body),
      ipHash: await hashIp(context.req.header("cf-connecting-ip")),
      occurredAt: now,
      submissionId: uuidv7(),
      contactCreatedEventId,
      formSubmittedEventId,
    });
    if (outcome === "duplicate") {
      return context.json({ data: { accepted: true, duplicate: true } }, 202);
    }
    for (const eventId of [contactCreatedEventId, formSubmittedEventId]) {
      try {
        await processPendingPublicFormEvent(database, eventId, context.env.JOBS_QUEUE);
      } catch (error) {
        logError("public_form.event_processing_failed", error, {
          workspaceId: form.workspaceId,
          formId: form.id,
          eventId,
        });
      }
    }
    return context.json({ data: { accepted: true, message: form.successMessage } }, 202);
  });
}
