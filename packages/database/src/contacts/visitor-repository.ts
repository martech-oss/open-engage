import { and, asc, eq, isNull, ne, or, lte, sql } from "drizzle-orm";

import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { contactEventOutbox, contactEventProjections, contactEvents, contacts } from "./schema";
import { siteVisitors, visitorBindings } from "./visitor-schema";

export class VisitorRepository extends DatabaseRepository {
  public async create(workspaceId: string, id: string, now = nowIso()): Promise<void> {
    await this.database.orm.insert(siteVisitors).values({ id, workspaceId, createdAt: now });
  }

  public async find(workspaceId: string, visitorId: string) {
    const row = await this.database.orm
      .select({ id: siteVisitors.id, contactId: contacts.id, email: contacts.email })
      .from(siteVisitors)
      .leftJoin(
        visitorBindings,
        and(
          eq(visitorBindings.workspaceId, siteVisitors.workspaceId),
          eq(visitorBindings.visitorId, siteVisitors.id),
        ),
      )
      .leftJoin(
        contacts,
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, visitorBindings.contactId),
          eq(contacts.status, "active"),
        ),
      )
      .where(and(eq(siteVisitors.workspaceId, workspaceId), eq(siteVisitors.id, visitorId)))
      .get();
    return row ?? null;
  }

  public async binding(workspaceId: string, visitorId: string) {
    return await this.database.orm
      .select()
      .from(visitorBindings)
      .where(
        and(eq(visitorBindings.workspaceId, workspaceId), eq(visitorBindings.visitorId, visitorId)),
      )
      .get();
  }

  public async findContact(workspaceId: string, contactId: string) {
    return await this.database.orm
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
  }

  /** A different binding raises a constraint instead of changing a browser's historical owner. */
  public bindingStatement(
    workspaceId: string,
    visitorId: string,
    contactId: string,
    linkedAt: string,
  ) {
    return this.database.orm
      .insert(visitorBindings)
      .values({ workspaceId, visitorId, contactId, linkedAt })
      .onConflictDoUpdate({
        target: [visitorBindings.workspaceId, visitorBindings.visitorId],
        set: {
          contactId: sql`CASE WHEN ${visitorBindings.contactId} = ${contactId} THEN ${contactId} ELSE NULL END`,
        },
      });
  }

  public async bind(workspaceId: string, visitorId: string, contactId: string): Promise<void> {
    await this.bindingStatement(workspaceId, visitorId, contactId, nowIso());
  }

  public async pendingHistory(limit = 20) {
    return await this.database.orm
      .select()
      .from(visitorBindings)
      .where(
        and(
          eq(visitorBindings.historyStatus, "pending"),
          or(isNull(visitorBindings.leaseExpiresAt), lte(visitorBindings.leaseExpiresAt, nowIso())),
        ),
      )
      .orderBy(asc(visitorBindings.linkedAt))
      .limit(limit);
  }

  public async claimHistory(workspaceId: string, visitorId: string, leaseId: string) {
    const now = nowIso();
    return await this.database.orm
      .update(visitorBindings)
      .set({ leaseId, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() })
      .where(
        and(
          eq(visitorBindings.workspaceId, workspaceId),
          eq(visitorBindings.visitorId, visitorId),
          eq(visitorBindings.historyStatus, "pending"),
          or(isNull(visitorBindings.leaseExpiresAt), lte(visitorBindings.leaseExpiresAt, now)),
        ),
      )
      .returning()
      .get();
  }

  public async restoreHistory(
    workspaceId: string,
    visitorId: string,
    contactId: string,
    limit = 25,
  ): Promise<string[]> {
    const orm = this.database.orm;
    const events = await orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .where(
        and(
          eq(contactEvents.workspaceId, workspaceId),
          eq(contactEvents.visitorId, visitorId),
          isNull(contactEvents.contactId),
        ),
      )
      .orderBy(asc(contactEvents.id))
      .limit(limit);
    for (const event of events) {
      const now = nowIso();
      await orm.batch([
        orm
          .update(contactEvents)
          .set({ contactId, replayMode: "history" })
          .where(and(eq(contactEvents.id, event.id), isNull(contactEvents.contactId))),
        orm
          .insert(contactEventOutbox)
          .values({ eventId: event.id, workspaceId, createdAt: now, status: "pending" })
          .onConflictDoUpdate({
            target: contactEventOutbox.eventId,
            set: {
              status: "pending",
              leaseId: null,
              leaseExpiresAt: null,
              nextAttemptAt: null,
              processedAt: null,
            },
          }),
        orm
          .insert(contactEventProjections)
          .values(
            ["scoring", "grade", "campaign"].map((projection) => ({
              eventId: event.id,
              workspaceId,
              projection,
              status: "pending",
              createdAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [contactEventProjections.eventId, contactEventProjections.projection],
            set: { status: "pending", completedAt: null },
          }),
      ]);
    }
    // Include previously restored work so an interrupted batch resumes before finishing the binding.
    const pending = await orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .innerJoin(contactEventOutbox, eq(contactEventOutbox.eventId, contactEvents.id))
      .where(
        and(
          eq(contactEvents.workspaceId, workspaceId),
          eq(contactEvents.visitorId, visitorId),
          eq(contactEvents.replayMode, "history"),
          ne(contactEventOutbox.status, "processed"),
        ),
      )
      .orderBy(asc(contactEvents.id))
      .limit(limit);
    return pending.map((event) => event.id);
  }

  public async hasHistoryWork(workspaceId: string, visitorId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .leftJoin(contactEventOutbox, eq(contactEventOutbox.eventId, contactEvents.id))
      .where(
        and(
          eq(contactEvents.workspaceId, workspaceId),
          eq(contactEvents.visitorId, visitorId),
          or(
            isNull(contactEvents.contactId),
            and(
              eq(contactEvents.replayMode, "history"),
              ne(contactEventOutbox.status, "processed"),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    return Boolean(row);
  }

  public async releaseHistory(
    workspaceId: string,
    visitorId: string,
    leaseId: string,
    done: boolean,
  ): Promise<void> {
    await this.database.orm
      .update(visitorBindings)
      .set({ historyStatus: done ? "done" : "pending", leaseId: null, leaseExpiresAt: null })
      .where(
        and(
          eq(visitorBindings.workspaceId, workspaceId),
          eq(visitorBindings.visitorId, visitorId),
          eq(visitorBindings.leaseId, leaseId),
        ),
      );
  }
}
