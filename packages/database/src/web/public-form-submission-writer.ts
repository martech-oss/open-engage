import { and, eq, sql } from "drizzle-orm";

import type { ProgramBinding } from "@openengage/core/projects";

import type { OpenEngageDatabase } from "../client";
import { contactEventProjectionRows } from "../contacts/event-repository";
import {
  contactEventOutbox,
  contactEventProjections,
  contactEvents,
  contacts,
} from "../contacts/schema";
import { VisitorRepository } from "../contacts/visitor-repository";
import { siteVisitors } from "../contacts/visitor-schema";
import { ProjectMemberRepository } from "../projects/program-member-repository";
import { uuidv7 } from "../shared/uuid";
import { formSubmissions } from "./schema";

export interface PersistPublicFormSubmissionInput {
  workspaceId: string;
  formId: string;
  email: string;
  idempotencyKey: string;
  visitorId?: string | null;
  requestFingerprint?: string;
  identityProofHash?: string | null;
  context?: Record<string, unknown>;
  programBinding?: ProgramBinding;
  contactFields: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    customFields: Record<string, unknown>;
  };
  payload: Record<string, unknown>;
  ipHash: string | null;
  occurredAt: string;
  submissionId: string;
  contactCreatedEventId: string;
  formSubmittedEventId: string;
}

/** Writes the contact, submission, event work, and projections in one D1 batch. */
export async function persistPublicFormSubmissionBatch(
  database: OpenEngageDatabase,
  input: PersistPublicFormSubmissionInput,
  existingContactId: string | null,
): Promise<{ contactId: string; visitorId: string | null }> {
  const orm = database.orm;
  const contactId = existingContactId ?? uuidv7();
  const programWork = input.programBinding
    ? await new ProjectMemberRepository(database, {
        workspaceId: input.workspaceId,
      }).prepareMutation(
        {
          ...input.programBinding,
          contactId,
          source: "form",
          idempotencyKey: `form:${input.submissionId}`,
        },
        input.occurredAt,
      )
    : null;
  const contactMutation = existingContactId
    ? orm
        .update(contacts)
        .set({
          firstName: sql`coalesce(${input.contactFields.firstName}, ${contacts.firstName})`,
          lastName: sql`coalesce(${input.contactFields.lastName}, ${contacts.lastName})`,
          phone: sql`coalesce(${input.contactFields.phone}, ${contacts.phone})`,
          ...(Object.keys(input.contactFields.customFields).length > 0
            ? {
                customFields: sql`json_patch(coalesce(${contacts.customFields}, '{}'), ${JSON.stringify(input.contactFields.customFields)})`,
              }
            : {}),
          updatedAt: input.occurredAt,
        })
        .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, contactId)))
    : orm.insert(contacts).values({
        id: contactId,
        workspaceId: input.workspaceId,
        email: input.email,
        acquisitionProjectId: input.programBinding?.projectId ?? null,
        firstName: input.contactFields.firstName,
        lastName: input.contactFields.lastName,
        phone: input.contactFields.phone,
        stage: "lead",
        score: 0,
        status: "active",
        customFields: JSON.stringify(input.contactFields.customFields),
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      });
  const identityStatements = input.visitorId
    ? [
        orm
          .insert(siteVisitors)
          .values({
            id: input.visitorId,
            workspaceId: input.workspaceId,
            createdAt: input.occurredAt,
          })
          .onConflictDoNothing(),
        new VisitorRepository(database).bindingStatement(
          input.workspaceId,
          input.visitorId,
          contactId,
          input.occurredAt,
        ),
      ]
    : [];
  const submission = orm.insert(formSubmissions).values({
    id: input.submissionId,
    workspaceId: input.workspaceId,
    formId: input.formId,
    contactId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint ?? "",
    identityProofHash: input.identityProofHash ?? null,
    visitorId: input.visitorId ?? null,
    payload: JSON.stringify(input.payload),
    ipHash: input.ipHash,
    createdAt: input.occurredAt,
  });
  const formSubmittedEvent = orm.insert(contactEvents).values({
    id: input.formSubmittedEventId,
    workspaceId: input.workspaceId,
    contactId,
    visitorId: input.visitorId ?? null,
    type: "form_submitted",
    resourceType: "form",
    resourceId: input.formId,
    properties: JSON.stringify({ ...input.context, formId: input.formId }),
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
  });
  const formSubmittedWork = orm.insert(contactEventOutbox).values({
    eventId: input.formSubmittedEventId,
    workspaceId: input.workspaceId,
    status: "pending",
    createdAt: input.occurredAt,
  });
  const formSubmittedProjections = orm.insert(contactEventProjections).values(
    contactEventProjectionRows({
      id: input.formSubmittedEventId,
      workspaceId: input.workspaceId,
      createdAt: input.occurredAt,
    }),
  );

  if (existingContactId) {
    await orm.batch([
      contactMutation,
      ...identityStatements,
      submission,
      formSubmittedEvent,
      formSubmittedWork,
      formSubmittedProjections,
      ...(programWork?.statements ?? []),
    ]);
    return { contactId, visitorId: input.visitorId ?? null };
  }
  await orm.batch([
    contactMutation,
    ...identityStatements,
    submission,
    orm.insert(contactEvents).values({
      id: input.contactCreatedEventId,
      workspaceId: input.workspaceId,
      contactId,
      type: "contact_created",
      resourceType: "contact",
      resourceId: contactId,
      properties: "{}",
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
    }),
    orm.insert(contactEventOutbox).values({
      eventId: input.contactCreatedEventId,
      workspaceId: input.workspaceId,
      status: "pending",
      createdAt: input.occurredAt,
    }),
    orm.insert(contactEventProjections).values(
      contactEventProjectionRows({
        id: input.contactCreatedEventId,
        workspaceId: input.workspaceId,
        createdAt: input.occurredAt,
      }),
    ),
    formSubmittedEvent,
    formSubmittedWork,
    formSubmittedProjections,
    ...(programWork?.statements ?? []),
  ]);
  return { contactId, visitorId: input.visitorId ?? null };
}
