import type { OpenEngageDatabase } from "@openengage/database/client";
import { FormProgramRepository, ProgramError } from "@openengage/database/projects";
import { uuidv7 } from "@openengage/database/shared";
import { PublicFormRepository, type PublicFormRecord } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { sha256Hex } from "../platform/crypto";
import { isRecord, primitiveString, stringOrNull } from "../platform/values";
import { hasTurnstileConfiguration } from "../web/config";
import { originAllowed, redactFormPayload } from "../web/domain";
import { VisitorIdentityService } from "../web/visitor-identity-service";
import { resolvePublicForm } from "./form-context";
import { validatePublicFormBody } from "./form-validation";
import { hashIp, verifyTurnstile } from "./shared";
import { selectPublicFormFields } from "./templates";

export interface SubmitPublicFormCommand {
  workspaceSlug: string;
  formSlug: string;
  body: unknown;
  origin: string | undefined;
  requestHostname: string;
  connectingIp: string | undefined;
  idempotencyKeyHeader: string | undefined;
  resolvedForm?: PublicFormRecord;
}

export type SubmitPublicFormResult =
  | { kind: "form_not_found" }
  | { kind: "turnstile_not_configured" }
  | { kind: "origin_denied" }
  | { kind: "invalid_payload" }
  | { kind: "honeypot" }
  | { kind: "idempotency_key_required" }
  | { kind: "duplicate"; visitorToken?: string }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_form_fields"; fields: Array<{ field: string; reason: string }> }
  | { kind: "turnstile_failed" }
  | {
      kind: "accepted";
      workspaceId: string;
      formId: string;
      successMessage: string;
      eventIds: [string, string];
      visitorToken?: string;
      visitorId?: string;
      contactId: string;
    };

export class SubmitPublicFormUseCase {
  public constructor(
    private readonly database: OpenEngageDatabase,
    private readonly environment: RuntimeEnv,
  ) {}

  public async execute(command: SubmitPublicFormCommand): Promise<SubmitPublicFormResult> {
    const repository = new PublicFormRepository(this.database);
    const resolved = await resolvePublicForm(this.database, this.environment, {
      workspaceSlug: command.workspaceSlug,
      formSlug: command.formSlug,
      measurementToken: isRecord(command.body) ? command.body["measurementToken"] : undefined,
      ...(command.resolvedForm ? { resolvedForm: command.resolvedForm } : {}),
    });
    if (resolved.kind === "form_not_found") return { kind: "form_not_found" };
    if (resolved.kind === "invalid_context") return { kind: "invalid_payload" };
    const { form, measurement } = resolved;
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
    const body = { ...command.body };
    if (body["_website"]) return { kind: "honeypot" };

    const idempotencyKey = command.idempotencyKeyHeader ?? primitiveString(body["idempotencyKey"]);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
      return { kind: "idempotency_key_required" };
    }
    const identity = new VisitorIdentityService(this.database, this.environment);
    const payloadForFingerprint = redactFormPayload(body);
    delete payloadForFingerprint["consent"];
    const requestFingerprint = await sha256Hex(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(payloadForFingerprint).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
    const originalVisitor =
      body["consent"] === true ? await identity.resolve(form.workspaceId, body["oe_v"]) : null;
    if (originalVisitor && measurement?.visitorId && originalVisitor.id !== measurement.visitorId)
      return { kind: "invalid_payload" };
    const identityProofHash = originalVisitor
      ? await sha256Hex(primitiveString(body["oe_v"]))
      : null;
    const acknowledgeDuplicate = async (): Promise<SubmitPublicFormResult> => {
      const prior = await repository.findSubmission({
        workspaceId: form.workspaceId,
        formId: form.id,
        idempotencyKey,
      });
      if (!prior || prior.requestFingerprint !== requestFingerprint)
        return { kind: "idempotency_conflict" };
      const proven =
        originalVisitor &&
        (prior.visitorId === originalVisitor.id ||
          (identityProofHash && prior.identityProofHash === identityProofHash));
      return {
        kind: "duplicate",
        ...(body["consent"] === true && proven && prior.visitorId
          ? { visitorToken: await identity.token(form.workspaceId, prior.visitorId) }
          : {}),
      };
    };
    const duplicate = await repository.findSubmission({
      workspaceId: form.workspaceId,
      formId: form.id,
      idempotencyKey,
    });
    if (duplicate) return await acknowledgeDuplicate();
    const visitor =
      body["consent"] === true ? await identity.ensure(form.workspaceId, body["oe_v"]) : null;
    // A newly supplied email never borrows another person's progressive answers.
    const sameEmail =
      visitor?.email?.toLowerCase() === primitiveString(body["email"]).trim().toLowerCase();
    const answered =
      visitor && sameEmail
        ? await repository.findAnsweredFieldsByVisitor(form.workspaceId, visitor.id)
        : new Set<string>();
    const validationIssues = validatePublicFormBody(form.definition, answered, body);
    if (validationIssues.length > 0) {
      return { kind: "invalid_form_fields", fields: validationIssues };
    }
    const visibleFields = new Set(
      selectPublicFormFields(form.definition, answered, body).map((field) =>
        field.kind === "custom" ? `custom:${field.key}` : field.key,
      ),
    );
    for (const field of form.definition.fields ?? []) {
      const key = field.kind === "custom" ? `custom:${field.key}` : field.key;
      if (!visibleFields.has(key)) delete body[key];
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
    const programs = new FormProgramRepository(this.database, { workspaceId: form.workspaceId });
    let programBinding;
    try {
      // Verified LP records always carry the published snapshot (legacy means no binding).
      programBinding = measurement
        ? (form.programBinding ?? null)
        : form.programBinding === undefined
          ? await programs.get(form.id)
          : form.programBinding;
      if (programBinding)
        await programs.validate(
          programBinding,
          typeof measurement?.properties["projectId"] === "string"
            ? measurement.properties["projectId"]
            : null,
        );
    } catch (error) {
      if (error instanceof ProgramError) return { kind: "invalid_payload" };
      throw error;
    }
    const occurredAt = new Date().toISOString();
    const contactCreatedEventId = uuidv7();
    const formSubmittedEventId = uuidv7();
    const outcome = await repository.persistSubmission({
      ...(programBinding ? { programBinding } : {}),
      workspaceId: form.workspaceId,
      formId: form.id,
      visitorId: visitor?.id ?? null,
      email: submittedEmail.trim().toLowerCase(),
      idempotencyKey,
      requestFingerprint,
      identityProofHash,
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
      ...(measurement ? { context: measurement.properties } : {}),
    });
    if (outcome.kind === "duplicate") return await acknowledgeDuplicate();
    const visitorToken =
      body["consent"] === true && outcome.visitorId
        ? await identity.token(form.workspaceId, outcome.visitorId)
        : undefined;
    return {
      kind: "accepted",
      contactId: outcome.contactId,
      ...(visitorToken ? { visitorToken, visitorId: outcome.visitorId! } : {}),
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
