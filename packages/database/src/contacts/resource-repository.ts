import { and, asc, count, desc, eq, exists, inArray, ne, sql, type SQL } from "drizzle-orm";

import { type ContactTimelineEvent } from "@openengage/core/contacts";
import { segmentFilterSchema, type SegmentFilter } from "@openengage/core/segments";
import { jsonRecordSchema } from "@openengage/core/shared";

import { deliveries } from "../messaging/schema";
import { segmentMemberships, segments } from "../segments/schema";
import { didChange, nowIso } from "../shared/database-utils";
import { decodeJson, decodeNullableJson } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { companies, companyContacts, contactEvents, contacts, contactTags, tags } from "./schema";
import { scoreEvents } from "./score-schema";

/** Cap on the score-event and timeline previews shown in the contact detail drawer. */
const CONTACT_DETAIL_FEED_LIMIT = 100;

/**
 * Queries for the resources hanging off a contact: tags, segments, accounts,
 * score events and the activity timeline.
 */
export class ContactResourceRepository extends WorkspaceRepository {
  /** Loads every filter option for the contact list page in one atomic batch. */
  public async getContactOptionRows() {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, segmentRows, stageRows, accountRows] = await orm.batch([
      orm
        .select({
          id: tags.id,
          name: tags.name,
          slug: tags.slug,
          color: tags.color,
          contactCount: count(contactTags.contactId).as("contact_count"),
        })
        .from(tags)
        .leftJoin(
          contactTags,
          and(eq(contactTags.workspaceId, tags.workspaceId), eq(contactTags.tagId, tags.id)),
        )
        .where(eq(tags.workspaceId, workspaceId))
        .groupBy(tags.id)
        .orderBy(asc(tags.name)),
      orm
        .select({
          id: segments.id,
          name: segments.name,
          slug: segments.slug,
          description: segments.description,
          kind: segments.kind,
          filterAst: segments.filterAst,
          membershipSource: segments.membershipSource,
          filterVersion: segments.filterVersion,
          memberCount: segments.memberCount,
          evaluatedAt: segments.evaluatedAt,
          evaluationStatus: segments.evaluationStatus,
          evaluationError: segments.evaluationError,
        })
        .from(segments)
        .where(eq(segments.workspaceId, workspaceId))
        .orderBy(asc(segments.name)),
      orm
        .select({ stage: contacts.stage, contactCount: count().as("contact_count") })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), ne(contacts.status, "archived")))
        .groupBy(contacts.stage)
        .orderBy(asc(contacts.stage)),
      orm
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          contactCount: sql<number>`count(case when ${contacts.status} != 'archived' then 1 end)`
            .mapWith(Number)
            .as("contact_count"),
        })
        .from(companies)
        .leftJoin(
          companyContacts,
          and(
            eq(companyContacts.workspaceId, companies.workspaceId),
            eq(companyContacts.companyId, companies.id),
          ),
        )
        .leftJoin(
          contacts,
          and(
            eq(contacts.workspaceId, companyContacts.workspaceId),
            eq(contacts.id, companyContacts.contactId),
          ),
        )
        .where(eq(companies.workspaceId, workspaceId))
        .groupBy(companies.id)
        .orderBy(asc(companies.name)),
    ]);
    return {
      tags: tagRows,
      segments: segmentRows.map((row) => ({ ...row, filterAst: parseFilterAst(row.filterAst) })),
      stages: stageRows,
      accounts: accountRows,
    };
  }

  /** Loads every relation shown on a contact profile in one atomic batch. */
  public async getContactProfileRows(contactId: string) {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, segmentRows, accountRows, scoreEventRows, timelineRows] = await orm.batch([
      orm
        .select({ id: tags.id, name: tags.name, slug: tags.slug, color: tags.color })
        .from(tags)
        .innerJoin(
          contactTags,
          and(eq(contactTags.workspaceId, tags.workspaceId), eq(contactTags.tagId, tags.id)),
        )
        .where(and(eq(contactTags.workspaceId, workspaceId), eq(contactTags.contactId, contactId)))
        .orderBy(asc(tags.name)),
      orm
        .select({
          id: segments.id,
          name: segments.name,
          kind: segments.kind,
          source: segmentMemberships.source,
          joinedAt: segmentMemberships.joinedAt,
        })
        .from(segments)
        .innerJoin(
          segmentMemberships,
          and(
            eq(segmentMemberships.workspaceId, segments.workspaceId),
            eq(segmentMemberships.segmentId, segments.id),
          ),
        )
        .where(
          and(
            eq(segmentMemberships.workspaceId, workspaceId),
            eq(segmentMemberships.contactId, contactId),
          ),
        )
        .orderBy(asc(segments.name)),
      orm
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          title: companyContacts.title,
          isPrimary: companyContacts.isPrimary,
        })
        .from(companies)
        .innerJoin(
          companyContacts,
          and(
            eq(companyContacts.workspaceId, companies.workspaceId),
            eq(companyContacts.companyId, companies.id),
          ),
        )
        .where(
          and(
            eq(companyContacts.workspaceId, workspaceId),
            eq(companyContacts.contactId, contactId),
          ),
        )
        .orderBy(desc(companyContacts.isPrimary), asc(companies.name)),
      orm
        .select({
          id: scoreEvents.id,
          delta: scoreEvents.delta,
          reason: scoreEvents.reason,
          createdAt: scoreEvents.createdAt,
        })
        .from(scoreEvents)
        .where(and(eq(scoreEvents.workspaceId, workspaceId), eq(scoreEvents.contactId, contactId)))
        .orderBy(desc(scoreEvents.createdAt))
        .limit(CONTACT_DETAIL_FEED_LIMIT),
      this.contactEventsQuery(contactId, CONTACT_DETAIL_FEED_LIMIT),
    ]);
    return {
      tags: tagRows,
      segments: segmentRows,
      accounts: accountRows,
      scoreEvents: scoreEventRows,
      timeline: timelineRows.map(toContactEvent),
    };
  }

  /** Newest-first activity feed for one contact. */
  public async listContactEvents(
    contactId: string,
    limit: number,
  ): Promise<ContactTimelineEvent[]> {
    const rows = await this.contactEventsQuery(contactId, limit);
    return rows.map(toContactEvent);
  }

  /** Loads the tag and account chips for a page of contacts in one batch. */
  public async listContactRelations(contactIds: string[]) {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, accountRows] = await orm.batch([
      orm
        .select({
          contactId: contactTags.contactId,
          id: tags.id,
          name: tags.name,
          slug: tags.slug,
          color: tags.color,
        })
        .from(contactTags)
        .innerJoin(
          tags,
          and(eq(tags.workspaceId, contactTags.workspaceId), eq(tags.id, contactTags.tagId)),
        )
        .where(
          and(eq(contactTags.workspaceId, workspaceId), inArray(contactTags.contactId, contactIds)),
        )
        .orderBy(asc(tags.name)),
      orm
        .select({
          contactId: companyContacts.contactId,
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          title: companyContacts.title,
          isPrimary: companyContacts.isPrimary,
        })
        .from(companyContacts)
        .innerJoin(
          companies,
          and(
            eq(companies.workspaceId, companyContacts.workspaceId),
            eq(companies.id, companyContacts.companyId),
          ),
        )
        .where(
          and(
            eq(companyContacts.workspaceId, workspaceId),
            inArray(companyContacts.contactId, contactIds),
          ),
        )
        .orderBy(desc(companyContacts.isPrimary), asc(companies.name)),
    ]);
    return { tags: tagRows, accounts: accountRows };
  }

  public async contactExists(contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(this.inWorkspace(contacts), eq(contacts.id, contactId)))
      .get();
    return row !== undefined;
  }

  public async findActiveContactId(contactId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          this.inWorkspace(contacts),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row?.id ?? null;
  }

  /** Inserts a tag; unique-slug violations bubble up to the caller. */
  public async createTag(input: {
    id: string;
    name: string;
    slug: string;
    color: string;
  }): Promise<void> {
    await this.database.orm.insert(tags).values({
      id: input.id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      color: input.color,
      createdAt: nowIso(),
    });
  }

  public async addContactTag(contactId: string, tagId: string): Promise<boolean> {
    return (await this.insertTagMemberships(eq(contacts.id, contactId), tagId)) > 0;
  }

  public bulkAddContactTag(contactIds: string[], tagId: string): Promise<number> {
    return this.insertTagMemberships(inArray(contacts.id, contactIds), tagId);
  }

  public async removeContactTag(contactId: string, tagId: string): Promise<boolean> {
    return (await this.deleteTagMemberships(eq(contactTags.contactId, contactId), tagId)) > 0;
  }

  public bulkRemoveContactTag(contactIds: string[], tagId: string): Promise<number> {
    return this.deleteTagMemberships(inArray(contactTags.contactId, contactIds), tagId);
  }

  /** Joins a contact to a static segment; dynamic segments reject the write. */
  public async addContactSegment(contactId: string, segmentId: string): Promise<boolean> {
    return (await this.insertSegmentMemberships(eq(contacts.id, contactId), segmentId)) > 0;
  }

  public bulkAddContactSegment(contactIds: string[], segmentId: string): Promise<number> {
    return this.insertSegmentMemberships(inArray(contacts.id, contactIds), segmentId);
  }

  /** Removes a manually added segment membership; dynamic memberships stay. */
  public async removeContactSegment(contactId: string, segmentId: string): Promise<boolean> {
    return (
      (await this.deleteSegmentMemberships(
        eq(segmentMemberships.contactId, contactId),
        segmentId,
      )) > 0
    );
  }

  public bulkRemoveContactSegment(contactIds: string[], segmentId: string): Promise<number> {
    return this.deleteSegmentMemberships(
      inArray(segmentMemberships.contactId, contactIds),
      segmentId,
    );
  }

  /**
   * Applies the delta and records a score event, atomically. Returns false
   * when the contact is missing or archived, in which case nothing is
   * written - the score event insert is itself an insert-from-select scoped
   * to the same filter, so it naturally no-ops alongside the update.
   */
  public async adjustContactScore(
    contactId: string,
    input: { delta: number; reason: string },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const now = nowIso();
    const orm = this.database.orm;
    const contactFilter = and(
      eq(contacts.workspaceId, workspaceId),
      eq(contacts.id, contactId),
      ne(contacts.status, "archived"),
    );
    const [updated] = await orm.batch([
      orm
        .update(contacts)
        .set({ score: sql`${contacts.score} + ${input.delta}`, updatedAt: now })
        .where(contactFilter),
      orm.insert(scoreEvents).select(
        orm
          .select({
            id: sql<string>`${uuidv7()}`.as("id"),
            workspaceId: contacts.workspaceId,
            contactId: contacts.id,
            delta: sql<number>`${input.delta}`.as("delta"),
            reason: sql<string>`${input.reason}`.as("reason"),
            automationEnrollmentId: sql<string | null>`null`.as("automation_enrollment_id"),
            createdAt: sql<string>`${now}`.as("created_at"),
          })
          .from(contacts)
          .where(contactFilter),
      ),
    ]);
    return didChange(updated);
  }

  /** Archives or restores many contacts at once, regardless of current status. */
  /** Archiving also scrubs the plaintext email off those contacts' email deliveries (see archiveContact). */
  public async bulkSetContactsArchived(contactIds: string[], archived: boolean): Promise<number> {
    const now = nowIso();
    const orm = this.database.orm;
    const contactsUpdate = orm
      .update(contacts)
      .set({
        status: archived ? "archived" : "active",
        archivedAt: archived ? now : null,
        updatedAt: now,
      })
      .where(and(this.inWorkspace(contacts), inArray(contacts.id, contactIds)));
    if (!archived) {
      const result = await contactsUpdate;
      return result.meta.changes;
    }
    const [result] = await orm.batch([
      contactsUpdate,
      orm
        .update(deliveries)
        .set({ recipient: null })
        .where(
          and(
            this.inWorkspace(deliveries),
            inArray(deliveries.contactId, contactIds),
            eq(deliveries.channel, "email"),
          ),
        ),
    ]);
    return result.meta.changes;
  }

  private contactEventsQuery(contactId: string, limit: number) {
    return this.database.orm
      .select({
        id: contactEvents.id,
        type: contactEvents.type,
        resourceType: contactEvents.resourceType,
        resourceId: contactEvents.resourceId,
        properties: contactEvents.properties,
        occurredAt: contactEvents.occurredAt,
      })
      .from(contactEvents)
      .where(and(this.inWorkspace(contactEvents), eq(contactEvents.contactId, contactId)))
      .orderBy(desc(contactEvents.occurredAt), desc(contactEvents.id))
      .limit(limit);
  }

  /**
   * Links every non-archived selected contact to the tag, skipping links that
   * already exist. Returns the number of rows actually written.
   */
  private async insertTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
    const now = nowIso();
    const result = await this.database.orm
      .insert(contactTags)
      .select(
        this.database.orm
          .select({
            workspaceId: contacts.workspaceId,
            contactId: contacts.id,
            tagId: tags.id,
            createdAt: sql<string>`${now}`.as("created_at"),
          })
          .from(contacts)
          .innerJoin(tags, eq(tags.workspaceId, contacts.workspaceId))
          .where(
            and(
              this.inWorkspace(contacts),
              contactFilter,
              ne(contacts.status, "archived"),
              eq(tags.id, tagId),
            ),
          ),
      )
      .onConflictDoNothing();
    return result.meta.changes;
  }

  /** Unlinks the tag from the selected contacts, ignoring archived contacts. */
  private async deleteTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
    const result = await this.database.orm.delete(contactTags).where(
      and(
        this.inWorkspace(contactTags),
        contactFilter,
        eq(contactTags.tagId, tagId),
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, contactTags.workspaceId),
                eq(contacts.id, contactTags.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
      ),
    );
    return result.meta.changes;
  }

  /**
   * Joins every non-archived selected contact to a static segment, skipping
   * memberships that already exist. Dynamic segments reject the write.
   * Returns the number of rows actually written.
   */
  private async insertSegmentMemberships(contactFilter: SQL, segmentId: string): Promise<number> {
    const now = nowIso();
    const result = await this.database.orm
      .insert(segmentMemberships)
      .select(
        this.database.orm
          .select({
            workspaceId: contacts.workspaceId,
            segmentId: segments.id,
            contactId: contacts.id,
            source: sql<string>`'static'`.as("source"),
            joinedAt: sql<string>`${now}`.as("joined_at"),
          })
          .from(contacts)
          .innerJoin(segments, eq(segments.workspaceId, contacts.workspaceId))
          .where(
            and(
              this.inWorkspace(contacts),
              contactFilter,
              ne(contacts.status, "archived"),
              eq(segments.id, segmentId),
              eq(segments.kind, "static"),
            ),
          ),
      )
      .onConflictDoNothing();
    return result.meta.changes;
  }

  /**
   * Removes manually added segment membership rows for the selected
   * non-archived contacts; dynamic memberships stay.
   */
  private async deleteSegmentMemberships(contactFilter: SQL, segmentId: string): Promise<number> {
    const result = await this.database.orm.delete(segmentMemberships).where(
      and(
        this.inWorkspace(segmentMemberships),
        contactFilter,
        eq(segmentMemberships.segmentId, segmentId),
        eq(segmentMemberships.source, "static"),
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, segmentMemberships.workspaceId),
                eq(contacts.id, segmentMemberships.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
      ),
    );
    return result.meta.changes;
  }
}

type ContactEventQueryRow = Omit<ContactTimelineEvent, "properties"> & { properties: string };

function toContactEvent(row: ContactEventQueryRow): ContactTimelineEvent {
  return {
    ...row,
    properties: decodeJson(row.properties, jsonRecordSchema, "contact_events.properties"),
  };
}

function parseFilterAst(value: string | null): SegmentFilter | null {
  return decodeNullableJson(value, segmentFilterSchema, "segments.filter_ast");
}
