import { and, asc, eq, notExists, sql } from "drizzle-orm";

import { stringArraySchema } from "@openengage/core/shared";
import {
  contentDocumentSchema,
  signupFormDefinitionSchema,
  type ContentDocument,
  type SignupFormDefinition,
} from "@openengage/core/web";

import { organization } from "../auth/schema";
import {
  contactEventOutbox,
  contactEventProjections,
  contactEvents,
  contacts,
} from "../contacts/schema";
import { isConstraintError, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { dueContactEventWork, isContactEmailConstraintError } from "./public-form-persistence";
import {
  persistPublicFormSubmissionBatch,
  type PersistPublicFormSubmissionInput,
} from "./public-form-submission-writer";
import {
  forms,
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
  id: string;
  workspaceId: string;
  name: string;
  definition: SignupFormDefinition;
  allowedDomains: string[];
  turnstileEnabled: boolean;
  successMessage: string;
}

export interface PublicFormContactEvent {
  id: string;
  workspaceId: string;
  contactId: string | null;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
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
      })
      .from(forms)
      .innerJoin(organization, eq(organization.id, forms.workspaceId))
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
    };
  }

  public async findContactIdByEmail(workspaceId: string, email: string): Promise<string | null> {
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
  ): Promise<"accepted" | "duplicate"> {
    if (await this.submissionExists(input)) return "duplicate";
    let retriedEmailRace = false;

    for (;;) {
      const existingContactId = await this.findContactIdByEmail(input.workspaceId, input.email);
      try {
        await persistPublicFormSubmissionBatch(this.database, input, existingContactId);
        return "accepted";
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        if (await this.submissionExists(input)) return "duplicate";
        if (
          !retriedEmailRace &&
          existingContactId === null &&
          isContactEmailConstraintError(error) &&
          (await this.findContactIdByEmail(input.workspaceId, input.email))
        ) {
          retriedEmailRace = true;
          continue;
        }
        throw error;
      }
    }
  }

  public async listDueContactEventIds(now: string, limit = 50): Promise<string[]> {
    const rows = await this.database.orm
      .select({ eventId: contactEventOutbox.eventId })
      .from(contactEventOutbox)
      .where(dueContactEventWork(now))
      .orderBy(asc(contactEventOutbox.createdAt))
      .limit(limit);
    return rows.map((row) => row.eventId);
  }

  public async claimContactEvent(
    eventId: string,
    now: string,
    leaseId: string,
    leaseExpiresAt: string,
  ): Promise<PublicFormContactEvent | null> {
    const claimed = await this.database.orm
      .update(contactEventOutbox)
      .set({
        status: "processing",
        attemptCount: sql`${contactEventOutbox.attemptCount} + 1`,
        leaseId,
        leaseExpiresAt,
      })
      .where(and(eq(contactEventOutbox.eventId, eventId), dueContactEventWork(now)))
      .returning({ eventId: contactEventOutbox.eventId })
      .get();
    if (!claimed) return null;
    const row = await this.database.orm
      .select({
        id: contactEvents.id,
        workspaceId: contactEvents.workspaceId,
        contactId: contactEvents.contactId,
        type: contactEvents.type,
        resourceType: contactEvents.resourceType,
        resourceId: contactEvents.resourceId,
        properties: contactEvents.properties,
        occurredAt: contactEvents.occurredAt,
      })
      .from(contactEventOutbox)
      .innerJoin(contactEvents, eq(contactEvents.id, contactEventOutbox.eventId))
      .where(and(eq(contactEventOutbox.eventId, eventId), eq(contactEventOutbox.leaseId, leaseId)))
      .get();
    if (!row) return null;
    const properties: unknown = JSON.parse(row.properties);
    return {
      ...row,
      properties:
        properties && typeof properties === "object" && !Array.isArray(properties)
          ? (properties as Record<string, unknown>)
          : {},
    };
  }

  public async markContactEventProcessed(eventId: string, leaseId: string): Promise<void> {
    await this.database.orm
      .update(contactEventOutbox)
      .set({
        status: "processed",
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null,
        processedAt: nowIso(),
      })
      .where(
        and(
          eq(contactEventOutbox.eventId, eventId),
          eq(contactEventOutbox.status, "processing"),
          eq(contactEventOutbox.leaseId, leaseId),
          notExists(
            this.database.orm
              .select({ eventId: contactEventProjections.eventId })
              .from(contactEventProjections)
              .where(
                and(
                  eq(contactEventProjections.eventId, eventId),
                  eq(contactEventProjections.status, "pending"),
                ),
              ),
          ),
        ),
      );
  }

  public async markContactEventFailed(
    eventId: string,
    leaseId: string,
    error: unknown,
    nextAttemptAt: string,
  ): Promise<void> {
    await this.database.orm
      .update(contactEventOutbox)
      .set({
        status: "pending",
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
      })
      .where(
        and(
          eq(contactEventOutbox.eventId, eventId),
          eq(contactEventOutbox.status, "processing"),
          eq(contactEventOutbox.leaseId, leaseId),
        ),
      );
  }

  public async updateContactFromFormSubmission(
    workspaceId: string,
    contactId: string,
    input: {
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      customFields?: Record<string, unknown>;
    },
  ): Promise<void> {
    const custom = input.customFields ?? {};
    await this.database.orm
      .update(contacts)
      .set({
        firstName: sql`coalesce(${input.firstName}, ${contacts.firstName})`,
        lastName: sql`coalesce(${input.lastName}, ${contacts.lastName})`,
        phone: sql`coalesce(${input.phone}, ${contacts.phone})`,
        // json_patch merges the submitted keys over the stored object, so a
        // form that asks for two fields never wipes the other twenty.
        ...(Object.keys(custom).length > 0
          ? {
              customFields: sql`json_patch(coalesce(${contacts.customFields}, '{}'), ${JSON.stringify(custom)})`,
            }
          : {}),
        updatedAt: nowIso(),
      })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
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
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.visitorId, visitorId),
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

  public async createContactFromFormSubmission(
    workspaceId: string,
    contactId: string,
    email: string,
    input: {
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      customFields?: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = nowIso();
    await this.database.orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      stage: "lead",
      score: 0,
      status: "active",
      customFields: JSON.stringify(input.customFields ?? {}),
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Unique-key violations (duplicate idempotency key) bubble up to the caller. */
  public async insertFormSubmission(input: {
    workspaceId: string;
    formId: string;
    contactId: string | null;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    ipHash: string | null;
  }): Promise<void> {
    await this.database.orm.insert(formSubmissions).values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      formId: input.formId,
      contactId: input.contactId,
      idempotencyKey: input.idempotencyKey,
      payload: JSON.stringify(input.payload),
      ipHash: input.ipHash,
      createdAt: nowIso(),
    });
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
          eq(landingPageVersions.id, landingPages.currentVersionId),
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
