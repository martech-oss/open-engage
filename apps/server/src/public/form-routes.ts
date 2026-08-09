import type { Hono } from "hono";
import * as z from "zod";

import { PublicFormRepository, uuidv7 } from "@openengage/database";

import { apiError } from "../auth/access";
import { recordContactEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";
import { isRecord, primitiveString, stringOrNull } from "../platform/values";
import { originAllowed, redactFormPayload } from "./domain";
import { safeJson } from "./http";
import { hashIp, verifyTurnstile } from "./shared";
import { formEmbedScript, renderPublicForm } from "./templates";

export function registerPublicFormRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/forms/:workspaceSlug/:formSlug/embed.js", async (context) => {
    const form = await new PublicFormRepository(context.get("database")).findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
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
    return new Response(formEmbedScript(formUrl, form.name, style), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  publicApp.get("/f/:workspaceSlug/:formSlug", async (context) => {
    const form = await new PublicFormRepository(context.get("database")).findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
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
    context.header(
      "Content-Security-Policy",
      `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' ${frameAncestors.join(" ")}`,
    );
    return context.html(renderPublicForm(form.name, form.definition, context.req.url));
  });

  publicApp.post("/f/:workspaceSlug/:formSlug", async (context) => {
    const database = context.get("database");
    const repository = new PublicFormRepository(database);
    const form = await repository.findPublishedForm(
      context.req.param("workspaceSlug"),
      context.req.param("formSlug"),
    );
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
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
    if (
      form.turnstileEnabled &&
      context.env.TURNSTILE_SECRET &&
      !(await verifyTurnstile(
        context.env.TURNSTILE_SECRET,
        primitiveString(body["turnstileToken"]),
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
    const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : null;
    const now = new Date().toISOString();
    let contactId: string | null = null;
    let contactCreated = false;
    if (email && z.email().safeParse(email).success) {
      const existingContactId = await repository.findContactIdByEmail(form.workspaceId, email);
      contactId = existingContactId ?? uuidv7();
      const contactFields = {
        firstName: stringOrNull(body["firstName"]),
        lastName: stringOrNull(body["lastName"]),
        phone: stringOrNull(body["phone"]),
      };
      if (existingContactId) {
        await repository.updateContactFromFormSubmission(
          form.workspaceId,
          contactId,
          contactFields,
        );
      } else {
        contactCreated = true;
        await repository.createContactFromFormSubmission(
          form.workspaceId,
          contactId,
          email,
          contactFields,
        );
      }
    }
    if (contactCreated && contactId) {
      await recordContactEvent(database, {
        workspaceId: form.workspaceId,
        contactId,
        type: "contact_created",
        resourceType: "contact",
        resourceId: contactId,
        occurredAt: now,
        queue: context.env.JOBS_QUEUE,
      });
    }
    try {
      await repository.insertFormSubmission({
        workspaceId: form.workspaceId,
        formId: form.id,
        contactId,
        idempotencyKey,
        payload: redactFormPayload(body),
        ipHash: await hashIp(context.req.header("cf-connecting-ip")),
      });
    } catch {
      return context.json({ data: { accepted: true, duplicate: true } }, 202);
    }
    await recordContactEvent(database, {
      workspaceId: form.workspaceId,
      contactId,
      type: "form_submitted",
      resourceType: "form",
      resourceId: form.id,
      properties: { formId: form.id },
      occurredAt: now,
      queue: context.env.JOBS_QUEUE,
    });
    return context.json({ data: { accepted: true, message: form.successMessage } }, 202);
  });
}
