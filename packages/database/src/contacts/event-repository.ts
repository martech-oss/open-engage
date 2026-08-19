import { and, asc, eq, exists, isNull, lte, notExists, or, sql } from "drizzle-orm";

import { jsonRecordSchema } from "@openengage/core/shared";

import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { contacts, contactEventOutbox, contactEventProjections, contactEvents } from "./schema";

export const CONTACT_EVENT_PROJECTIONS = [
  "scoring",
  "grade",
  "campaign",
  "decision_wake",
  "automation_enrollment",
  "segment_reconcile",
] as const;

export type ContactEventProjection = (typeof CONTACT_EVENT_PROJECTIONS)[number];

export interface ContactEventRecord {
  id: string;
  workspaceId: string;
  contactId: string | null;
  visitorId: string | null;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
}

export interface ContactEventCreate extends Omit<ContactEventRecord, "properties"> {
  properties: Record<string, unknown>;
  createdAt: string;
}

const propertiesCodec = defineJsonCodec(jsonRecordSchema, "contact_events.properties");

/** Rows inserted alongside an event anywhere that already owns a larger atomic batch. */
export function contactEventProjectionRows(event: {
  id: string;
  workspaceId: string;
  createdAt: string;
}) {
  return CONTACT_EVENT_PROJECTIONS.map((projection) => ({
    eventId: event.id,
    workspaceId: event.workspaceId,
    projection,
    status: "pending" as const,
    createdAt: event.createdAt,
  }));
}

/** Durable contact-event work store shared by synchronous producers and cron retry. */
export class ContactEventRepository extends DatabaseRepository {
  public async create(input: ContactEventCreate): Promise<void> {
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(contactEvents).values({
        id: input.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        visitorId: input.visitorId,
        type: input.type,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        properties: propertiesCodec.encode(input.properties),
        occurredAt: input.occurredAt,
        createdAt: input.createdAt,
      }),
      orm.insert(contactEventOutbox).values({
        eventId: input.id,
        workspaceId: input.workspaceId,
        status: "pending",
        createdAt: input.createdAt,
      }),
      orm.insert(contactEventProjections).values(contactEventProjectionRows(input)),
    ]);
  }

  public async listDueIds(now: string, limit = 50): Promise<string[]> {
    const rows = await this.database.orm
      .select({ eventId: contactEventOutbox.eventId })
      .from(contactEventOutbox)
      .where(dueEventWork(now))
      .orderBy(asc(contactEventOutbox.createdAt))
      .limit(limit);
    return rows.map((row) => row.eventId);
  }

  public async claim(
    eventId: string,
    now: string,
    leaseId: string,
    leaseExpiresAt: string,
  ): Promise<ContactEventRecord | null> {
    const claimed = await this.database.orm
      .update(contactEventOutbox)
      .set({
        status: "processing",
        attemptCount: sql`${contactEventOutbox.attemptCount} + 1`,
        leaseId,
        leaseExpiresAt,
      })
      .where(and(eq(contactEventOutbox.eventId, eventId), dueEventWork(now)))
      .returning({ eventId: contactEventOutbox.eventId })
      .get();
    if (!claimed) return null;
    const row = await this.database.orm
      .select({
        id: contactEvents.id,
        workspaceId: contactEvents.workspaceId,
        contactId: contactEvents.contactId,
        visitorId: contactEvents.visitorId,
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
    return row
      ? {
          ...row,
          properties: decodeJson(row.properties, jsonRecordSchema, "contact_events.properties"),
        }
      : null;
  }

  public async isContactActive(workspaceId: string, contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          eq(contacts.status, "active"),
        ),
      )
      .get();
    return Boolean(row);
  }

  public async pendingProjections(eventId: string): Promise<ContactEventProjection[]> {
    const rows = await this.database.orm
      .select({ projection: contactEventProjections.projection })
      .from(contactEventProjections)
      .where(
        and(
          eq(contactEventProjections.eventId, eventId),
          eq(contactEventProjections.status, "pending"),
        ),
      );
    const pending = new Set(rows.map((row) => row.projection));
    return CONTACT_EVENT_PROJECTIONS.filter((projection) => pending.has(projection));
  }

  public async finishProjection(
    eventId: string,
    leaseId: string,
    projection: ContactEventProjection,
    outcome: "completed" | "skipped",
    now: string,
  ): Promise<void> {
    await this.database.orm
      .update(contactEventProjections)
      .set({ status: outcome, completedAt: now })
      .where(
        and(
          eq(contactEventProjections.eventId, eventId),
          eq(contactEventProjections.projection, projection),
          eq(contactEventProjections.status, "pending"),
          exists(
            this.database.orm
              .select({ eventId: contactEventOutbox.eventId })
              .from(contactEventOutbox)
              .where(
                and(
                  eq(contactEventOutbox.eventId, eventId),
                  eq(contactEventOutbox.status, "processing"),
                  eq(contactEventOutbox.leaseId, leaseId),
                ),
              ),
          ),
        ),
      );
  }

  public async skipPending(eventId: string, leaseId: string, now: string): Promise<void> {
    await this.database.orm
      .update(contactEventProjections)
      .set({ status: "skipped", completedAt: now })
      .where(
        and(
          eq(contactEventProjections.eventId, eventId),
          eq(contactEventProjections.status, "pending"),
          exists(
            this.database.orm
              .select({ eventId: contactEventOutbox.eventId })
              .from(contactEventOutbox)
              .where(
                and(
                  eq(contactEventOutbox.eventId, eventId),
                  eq(contactEventOutbox.status, "processing"),
                  eq(contactEventOutbox.leaseId, leaseId),
                ),
              ),
          ),
        ),
      );
  }

  public async markProcessed(eventId: string, leaseId: string, now: string): Promise<void> {
    await this.database.orm
      .update(contactEventOutbox)
      .set({
        status: "processed",
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null,
        processedAt: now,
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

  public async markFailed(
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
}

function dueEventWork(now: string) {
  return or(
    and(
      eq(contactEventOutbox.status, "pending"),
      or(isNull(contactEventOutbox.nextAttemptAt), lte(contactEventOutbox.nextAttemptAt, now)),
    ),
    and(eq(contactEventOutbox.status, "processing"), lte(contactEventOutbox.leaseExpiresAt, now)),
  );
}
