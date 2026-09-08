import { and, eq } from "drizzle-orm";

import { programBindingSchema, type ProgramBinding } from "@openengage/core/projects";
import { stringArraySchema } from "@openengage/core/shared";
import {
  contentDocumentSchema,
  signupFormDefinitionSchema,
  type ContentDocument,
  type SignupFormDefinition,
} from "@openengage/core/web";

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";
import { VisitorRepository } from "../contacts/visitor-repository";
import { visitorBindings } from "../contacts/visitor-schema";
import { isProgramWriteConflict } from "../projects/program-member-repository";
import { isConstraintError } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { isContactEmailConstraintError } from "./public-form-persistence";
import {
  persistPublicFormSubmissionBatch,
  type PersistPublicFormSubmissionInput,
} from "./public-form-submission-writer";
import {
  forms,
  formVersions,
  formSubmissions,
  landingPages,
  landingPageVersions,
  siteTrackingSettings,
} from "./schema";

const formDefinitionCodec = defineJsonCodec(signupFormDefinitionSchema, "forms.definition");
const formAllowedDomainsCodec = defineJsonCodec(stringArraySchema, "forms.allowed_domains");
const landingPageContentCodec = defineJsonCodec(
  contentDocumentSchema,
  "landing_page_versions.content_document",
);
const trackingAllowedDomainsCodec = defineJsonCodec(
  stringArraySchema,
  "site_tracking_settings.allowed_domains",
);

export interface PublicFormRecord {
  /** Public lookups always supply a publication snapshot, including an explicitly unbound null. */
  programBinding?: ProgramBinding | null;
  id: string;
  workspaceId: string;
  name: string;
  definition: SignupFormDefinition;
  allowedDomains: string[];
  turnstileEnabled: boolean;
  successMessage: string;
}

export type { PersistPublicFormSubmissionInput } from "./public-form-submission-writer";

/**
 * Public, unauthenticated lookups and writes behind the hosted signup form
 * and its submission endpoint. Intentionally not workspace-scoped, like
 * {@link MessagingWorkerRepository}: the first call resolves the workspace
 * from the public slug pair, and callers pass the resolved id to every call
 * after that.
 */
export class PublicFormRepository extends DatabaseRepository {
  /** Resolve the URL identity before choosing a mutable form or a signed snapshot. */
  public async findFormReference(workspaceSlug: string, formSlug: string) {
    return this.database.orm
      .select({ id: forms.id, workspaceId: forms.workspaceId, status: forms.status })
      .from(forms)
      .innerJoin(organization, eq(organization.id, forms.workspaceId))
      .where(and(eq(organization.slug, workspaceSlug), eq(forms.slug, formSlug)))
      .get();
  }

  /** Resolves a published form from its public workspace-slug/form-slug pair. */
  public async findPublishedForm(
    workspaceSlug: string,
    formSlug: string,
  ): Promise<PublicFormRecord | null> {
    const row = await this.database.orm
      .select({
        id: forms.id,
        workspaceId: forms.workspaceId,
        name: forms.name,
        definition: forms.definition,
        allowedDomains: forms.allowedDomains,
        turnstileEnabled: forms.turnstileEnabled,
        successMessage: forms.successMessage,
        programBinding: formVersions.programBinding,
      })
      .from(forms)
      .innerJoin(organization, eq(organization.id, forms.workspaceId))
      .leftJoin(
        formVersions,
        and(
          eq(formVersions.workspaceId, forms.workspaceId),
          eq(formVersions.formId, forms.id),
          eq(formVersions.version, forms.version),
        ),
      )
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(forms.slug, formSlug),
          eq(forms.status, "published"),
        ),
      )
      .get();
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      definition: formDefinitionCodec.decode(row.definition),
      allowedDomains: formAllowedDomainsCodec.decode(row.allowedDomains),
      turnstileEnabled: row.turnstileEnabled,
      successMessage: row.successMessage,
      programBinding: row.programBinding
        ? programBindingSchema.parse(JSON.parse(row.programBinding))
        : null,
    };
  }

  private async findContactIdByEmail(workspaceId: string, email: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
      .get();
    return row?.id ?? null;
  }

  /**
   * Accepts one submission in a single D1 transaction. The form submission's
   * unique key is part of the same batch as contact mutation and event work,
   * so a duplicate race rolls every earlier statement back.
   */
  public async persistSubmission(
    input: PersistPublicFormSubmissionInput,
  ): Promise<
    | { kind: "accepted"; contactId: string; visitorId: string | null }
    | { kind: "duplicate"; contactId: string | null; visitorId: string | null }
  > {
    const duplicate = await this.findSubmission(input);
    if (duplicate) return { kind: "duplicate", ...duplicate };
    let visitorId = input.visitorId ?? null;
    const visitors = new VisitorRepository(this.database);
    for (let attempt = 0; attempt < 3; attempt++) {
      const existingContactId = await this.findContactIdByEmail(input.workspaceId, input.email);
      if (visitorId) {
        const binding = await visitors.binding(input.workspaceId, visitorId);
        if (binding && binding.contactId !== existingContactId) visitorId = uuidv7();
      }
      try {
        const result = await persistPublicFormSubmissionBatch(
          this.database,
          { ...input, visitorId },
          existingContactId,
        );
        return { kind: "accepted", ...result };
      } catch (error) {
        if (isProgramWriteConflict(error)) continue;
        if (!isConstraintError(error)) throw error;
        const duplicate = await this.findSubmission(input);
        if (duplicate) return { kind: "duplicate", ...duplicate };
        const binding = visitorId ? await visitors.binding(input.workspaceId, visitorId) : null;
        if (binding && binding.contactId !== existingContactId) {
          visitorId = uuidv7();
          continue;
        }
        if (
          existingContactId === null &&
          isContactEmailConstraintError(error) &&
          (await this.findContactIdByEmail(input.workspaceId, input.email))
        )
          continue;
        throw error;
      }
    }
    throw new Error("Concurrent form submission could not be reconciled");
  }

  public async findSubmission(
    input: Pick<PersistPublicFormSubmissionInput, "workspaceId" | "formId" | "idempotencyKey">,
  ) {
    return await this.database.orm
      .select({
        contactId: formSubmissions.contactId,
        visitorId: formSubmissions.visitorId,
        requestFingerprint: formSubmissions.requestFingerprint,
        identityProofHash: formSubmissions.identityProofHash,
      })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.workspaceId, input.workspaceId),
          eq(formSubmissions.formId, input.formId),
          eq(formSubmissions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .get();
  }

  /**
   * Progressive Profiling needs to know which fields this visitor has already
   * answered. Returns the keys that currently hold a value, standard columns
   * and custom-field keys alike.
   */
  public async findAnsweredFieldsByVisitor(
    workspaceId: string,
    visitorId: string,
  ): Promise<Set<string>> {
    const row = await this.database.orm
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        customFields: contacts.customFields,
      })
      .from(contacts)
      .innerJoin(
        visitorBindings,
        and(
          eq(visitorBindings.workspaceId, contacts.workspaceId),
          eq(visitorBindings.contactId, contacts.id),
        ),
      )
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(visitorBindings.visitorId, visitorId),
          eq(contacts.status, "active"),
        ),
      )
      .get();
    const answered = new Set<string>();
    if (!row) return answered;
    if (row.firstName) answered.add("firstName");
    if (row.lastName) answered.add("lastName");
    if (row.phone) answered.add("phone");
    const parsed: unknown = JSON.parse(row.customFields || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && value !== undefined && value !== "") answered.add(key);
      }
    }
    return answered;
  }

  public async submissionExists(
    input: Pick<PersistPublicFormSubmissionInput, "workspaceId" | "formId" | "idempotencyKey">,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.workspaceId, input.workspaceId),
          eq(formSubmissions.formId, input.formId),
          eq(formSubmissions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .get();
    return Boolean(row);
  }
}

/** Validated public reads shared by landing-page and tracking routes. */
export class PublicWebRepository extends DatabaseRepository {
  public async findPublishedLandingPage(
    workspaceSlug: string,
    pageSlug: string,
  ): Promise<{ contentDocument: ContentDocument; workspaceName: string } | null> {
    const row = await this.database.orm
      .select({
        contentDocument: landingPageVersions.contentDocument,
        workspaceName: organization.name,
      })
      .from(landingPages)
      .innerJoin(organization, eq(organization.id, landingPages.workspaceId))
      .innerJoin(
        landingPageVersions,
        and(
          eq(landingPageVersions.id, landingPages.publishedVersionId),
          eq(landingPageVersions.workspaceId, landingPages.workspaceId),
        ),
      )
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(landingPages.slug, pageSlug),
          eq(landingPages.status, "published"),
        ),
      )
      .get();
    return row
      ? {
          workspaceName: row.workspaceName,
          contentDocument: landingPageContentCodec.decode(row.contentDocument),
        }
      : null;
  }

  public async findTrackingWorkspace(
    workspaceSlug: string,
  ): Promise<{ id: string; allowedDomains: string[] } | null> {
    const row = await this.database.orm
      .select({ id: organization.id, allowedDomains: siteTrackingSettings.allowedDomains })
      .from(organization)
      .innerJoin(siteTrackingSettings, eq(siteTrackingSettings.workspaceId, organization.id))
      .where(and(eq(organization.slug, workspaceSlug), eq(siteTrackingSettings.enabled, true)))
      .get();
    return row
      ? { id: row.id, allowedDomains: trackingAllowedDomainsCodec.decode(row.allowedDomains) }
      : null;
  }
}
