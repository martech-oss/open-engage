import { and, asc, eq, exists, isNull, lte, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { jsonRecordSchema } from "@openengage/core/shared";

import type { Database } from "../client";
import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { contacts, contactEventOutbox, contactEventProjections, contactEvents } from "./schema";
import { visitorBindings } from "./visitor-schema";

export const CONTACT_EVENT_PROJECTIONS = [
  "scoring",
  "grade",
  "campaign",
  "decision_wake",
  "automation_enrollment",
  "segment_reconcile",
] as const;

export type ContactEventProjection = (typeof CONTACT_EVENT_PROJECTIONS)[number];

/** Projections a replayed visitor-history event still runs; the rest are skipped. */
export const HISTORY_REPLAY_PROJECTIONS: readonly ContactEventProjection[] = [
  "scoring",
  "grade",
  "campaign",
];

export interface ContactEventRecord {
  id: string;
  workspaceId: string;
  contactId: string | null;
  visitorId: string | null;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown>;
  replayMode?: string;
  occurredAt: string;
}

export interface ContactEventCreate extends Omit<ContactEventRecord, "properties"> {
  properties: Record<string, unknown>;
  replayMode?: string;
  createdAt: string;
}

/** A live contact event to write; `contactId` may be a SQL lookup resolved inside the batch. */
export interface ContactEventWrite {
  id: string;
  workspaceId: string;
  contactId: string | SQL | null;
  visitorId?: string | null | undefined;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

const propertiesCodec = defineJsonCodec(jsonRecordSchema, "contact_events.properties");

/** Pending projection rows for an event; all projections unless a subset is given. */
export function contactEventProjectionRows(
  event: { id: string; workspaceId: string; createdAt: string },
  projections: readonly ContactEventProjection[] = CONTACT_EVENT_PROJECTIONS,
) {
  return projections.map((projection) => ({
    eventId: event.id,
    workspaceId: event.workspaceId,
    projection,
    status: "pending" as const,
    createdAt: event.createdAt,
  }));
}

/**
 * The event row, its outbox marker and its pending projections, for a caller
 * that owns the atomic batch. With `when`, each insert runs only while that
 * predicate holds.
 */
export function contactEventStatements(
  orm: Database,
  event: ContactEventWrite,
  options: { when?: SQL } = {},
): [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
  const properties = propertiesCodec.encode(event.properties);
  const visitorId = event.visitorId ?? null;
  const projections = contactEventProjectionRows(event);
  const { when } = options;
  if (when) {
    return [
      orm.insert(contactEvents).select(
        sql`SELECT
          ${event.id}, ${event.workspaceId}, ${event.contactId}, ${visitorId}, 'live', ${event.type},
          ${event.resourceType}, ${event.resourceId}, ${properties}, ${event.occurredAt}, NULL,
          ${event.createdAt}
        WHERE ${when}`,
      ),
      orm.insert(contactEventOutbox).select(
        sql`SELECT
          ${event.id}, ${event.workspaceId}, 'pending', 0, NULL,
          NULL, NULL, NULL, ${event.createdAt}, NULL
        WHERE ${when}`,
      ),
      ...projections.map((row) =>
        orm.insert(contactEventProjections).select(
          sql`SELECT
            ${row.eventId}, ${row.workspaceId}, ${row.projection}, ${row.status},
            ${row.createdAt}, NULL
          WHERE ${when}`,
        ),
      ),
    ];
  }
  return [
    orm.insert(contactEvents).values({
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      visitorId,
      type: event.type,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      properties,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    }),
    orm.insert(contactEventOutbox).values({
      eventId: event.id,
      workspaceId: event.workspaceId,
      status: "pending",
      createdAt: event.createdAt,
    }),
    orm.insert(contactEventProjections).values(projections),
  ];
}

/** Durable contact-event work store shared by synchronous producers and cron retry. */
export class ContactEventRepository extends DatabaseRepository {
  public async create(input: ContactEventCreate): Promise<void> {
    await this.database.orm.batch(
      contactEventStatements(this.database.orm, {
        ...input,
        contactId:
          input.contactId ??
          (input.visitorId
            ? sql`(SELECT ${visitorBindings.contactId} FROM ${visitorBindings} WHERE ${visitorBindings.workspaceId} = ${input.workspaceId} AND ${visitorBindings.visitorId} = ${input.visitorId})`
            : null),
      }),
    );
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
        replayMode: contactEvents.replayMode,
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

  public async isContactProcessable(workspaceId: string, contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
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
