import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { type ContactTimelineEvent } from "@openengage/core/contacts";
import { segmentFilterSchema, type SegmentFilter } from "@openengage/core/segments";
import { jsonRecordSchema } from "@openengage/core/shared";

import { scoreEvents } from "../scoring/schema";
import { segmentMemberships, segments } from "../segments/schema";
import { decodeJson, decodeNullableJson } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { companies, companyContacts, contactEvents, contacts, contactTags, tags } from "./schema";

const CONTACT_DETAIL_FEED_LIMIT = 100;

export class ContactResourceQueryRepository extends WorkspaceRepository {
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
