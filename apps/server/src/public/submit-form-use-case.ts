import type { OpenEngageDatabase } from "@openengage/database/client";
import { uuidv7 } from "@openengage/database/shared";
import { PublicFormRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { isRecord, primitiveString, stringOrNull } from "../platform/values";
import { hasTurnstileConfiguration } from "../web/config";
import { originAllowed, redactFormPayload } from "../web/domain";
import { validatePublicFormBody } from "./form-validation";
import { hashIp, verifyTurnstile } from "./shared";

export interface SubmitPublicFormCommand {
  workspaceSlug: string;
  formSlug: string;
  body: unknown;
  origin: string | undefined;
  requestHostname: string;
  connectingIp: string | undefined;
  idempotencyKeyHeader: string | undefined;
}

export type SubmitPublicFormResult =
  | { kind: "form_not_found" }
  | { kind: "turnstile_not_configured" }
  | { kind: "origin_denied" }
  | { kind: "invalid_payload" }
  | { kind: "honeypot" }
  | { kind: "idempotency_key_required" }
  | { kind: "duplicate" }
  | { kind: "invalid_form_fields"; fields: Array<{ field: string; reason: string }> }
  | { kind: "turnstile_failed" }
  | {
      kind: "accepted";
      workspaceId: string;
      formId: string;
      successMessage: string;
      eventIds: [string, string];
    };

export class SubmitPublicFormUseCase {
  public constructor(
    private readonly database: OpenEngageDatabase,
    private readonly environment: RuntimeEnv,
  ) {}

  public async execute(command: SubmitPublicFormCommand): Promise<SubmitPublicFormResult> {
    const repository = new PublicFormRepository(this.database);
    const form = await repository.findPublishedForm(command.workspaceSlug, command.formSlug);
    if (!form) return { kind: "form_not_found" };
    if (form.turnstileEnabled && !hasTurnstileConfiguration(this.environment)) {
      return { kind: "turnstile_not_configured" };
    }
    if (
      command.origin &&
      new URL(command.origin).hostname !== command.requestHostname &&
      form.allowedDomains.length > 0 &&
      !originAllowed(command.origin, form.allowedDomains)
    ) {
      return { kind: "origin_denied" };
    }
    if (!isRecord(command.body)) return { kind: "invalid_payload" };
    const body = command.body;
    if (body["_website"]) return { kind: "honeypot" };

    const idempotencyKey = command.idempotencyKeyHeader ?? primitiveString(body["idempotencyKey"]);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
      return { kind: "idempotency_key_required" };
    }
    if (
      await repository.submissionExists({
        workspaceId: form.workspaceId,
        formId: form.id,
        idempotencyKey,
      })
    ) {
      return { kind: "duplicate" };
    }

    const visitorId = primitiveString(body["oe_v"]);
    const answered = visitorId
      ? await repository.findAnsweredFieldsByVisitor(form.workspaceId, visitorId)
      : new Set<string>();
    const validationIssues = validatePublicFormBody(form.definition, answered, body);
    if (validationIssues.length > 0) {
      return { kind: "invalid_form_fields", fields: validationIssues };
    }
    if (
      form.turnstileEnabled &&
      !(await verifyTurnstile(
        this.environment.TURNSTILE_SECRET ?? "",
        primitiveString(body["cf-turnstile-response"]) || primitiveString(body["turnstileToken"]),
        command.connectingIp,
        { workspaceId: form.workspaceId, formId: form.id, publicKey: idempotencyKey },
      ))
    ) {
      return { kind: "turnstile_failed" };
    }

    const submittedEmail = body["email"];
    if (typeof submittedEmail !== "string") {
      return {
        kind: "invalid_form_fields",
        fields: [{ field: "email", reason: "required" }],
      };
    }
    const occurredAt = new Date().toISOString();
    const contactCreatedEventId = uuidv7();
    const formSubmittedEventId = uuidv7();
    const outcome = await repository.persistSubmission({
      workspaceId: form.workspaceId,
      formId: form.id,
      email: submittedEmail.trim().toLowerCase(),
      idempotencyKey,
      contactFields: {
        firstName: stringOrNull(body["firstName"]),
        lastName: stringOrNull(body["lastName"]),
        phone: stringOrNull(body["phone"]),
        customFields: readCustomFields(body),
      },
      payload: redactFormPayload(body),
      ipHash: await hashIp(command.connectingIp),
      occurredAt,
      submissionId: uuidv7(),
      contactCreatedEventId,
      formSubmittedEventId,
    });
    if (outcome === "duplicate") return { kind: "duplicate" };
    return {
      kind: "accepted",
      workspaceId: form.workspaceId,
      formId: form.id,
      successMessage: form.successMessage,
      eventIds: [contactCreatedEventId, formSubmittedEventId],
    };
  }
}

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
