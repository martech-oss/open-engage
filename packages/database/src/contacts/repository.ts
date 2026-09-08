import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  lt,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  contactSchema,
  type Contact,
  type ContactCreate,
  type ContactUpdate,
} from "@openengage/core/contacts";
import { jsonRecordSchema, type WorkspaceContext } from "@openengage/core/shared";

import { deliveries } from "../messaging/schema";
import { segmentMemberships, segments } from "../segments/schema";
import { didChange, ensureLoaded, nowIso } from "../shared/database-utils";
import { decodeJson } from "../shared/json-codec";
import type { CursorPage } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { contactEventProjectionRows } from "./event-repository";
import { buildContactFilterPredicate } from "./filter-predicate";
import {
  companies,
  companyContacts,
  contactEventOutbox,
  contactEventProjections,
  contactEvents,
  contacts,
  contactTags,
  tags,
} from "./schema";

type ContactRow = typeof contacts.$inferSelect;

export type InitialContactRelationField = "tagId" | "segmentId" | "companyId";

export interface InitialContactRelations {
  tagId?: string;
  segmentId?: string;
  companyId?: string;
}

export class ContactRelationInvalidError extends Error {
  public override readonly name = "ContactRelationInvalidError";

  public constructor(public readonly field: InitialContactRelationField) {
    super(`Invalid initial contact relation: ${field}`);
  }
}

export class ContactRepository extends WorkspaceRepository<WorkspaceContext> {
  public async listContacts(input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    query?: string | undefined;
    status?: "active" | "archived" | "anonymous" | "all" | undefined;
    stage?: string | undefined;
    tagId?: string | undefined;
    companyId?: string | undefined;
    segmentId?: string | undefined;
    scoreMin?: number | undefined;
    scoreMax?: number | undefined;
    sort?: "createdAt" | "updatedAt" | "score" | "name" | "email" | undefined;
    direction?: "asc" | "desc" | undefined;
  }): Promise<CursorPage<Contact>> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const filterPredicate = buildContactFilterPredicate(this.database, this.context.workspaceId, {
      ...input,
      status: input.status ?? "active",
    });
    const ascending = input.direction === "asc";
    const sortColumn = {
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      score: contacts.score,
      gradePoints: contacts.gradePoints,
      name: sql<string>`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, '')`,
      email: sql<string>`coalesce(${contacts.email}, '')`,
    }[input.sort ?? "updatedAt"];
    const [totalRow] = await this.database.orm
      .select({ count: count() })
      .from(contacts)
      .where(filterPredicate);
    const pageConditions: SQL[] = [filterPredicate];
    if (input.cursor) {
      const [cursor] = await this.database.orm
        .select({ sortValue: sortColumn })
        .from(contacts)
        .where(and(this.inWorkspace(contacts), eq(contacts.id, input.cursor)))
        .limit(1);
      if (cursor) {
        pageConditions.push(
          or(
            compare(sortColumn, cursor.sortValue, ascending),
            and(
              equal(sortColumn, cursor.sortValue),
              ascending ? gt(contacts.id, input.cursor) : lt(contacts.id, input.cursor),
            ),
          )!,
        );
      }
    }
    const order = ascending ? asc : desc;
    const rows = await this.database.orm
      .select()
      .from(contacts)
      .where(and(...pageConditions))
      .orderBy(order(sortColumn), order(contacts.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toContact);
    const last = items.at(-1);
    return {
      items,
      total: totalRow?.count ?? 0,
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    };
  }

  public async getContact(id: string): Promise<Contact | null> {
    const row = await this.database.orm.query.contacts.findFirst({
      where: and(this.inWorkspace(contacts), eq(contacts.id, id)),
    });
    return row ? toContact(row) : null;
  }

  public async createContact(input: ContactCreate): Promise<Contact> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(contacts).values({
      id,
      workspaceId: this.context.workspaceId,
      email: input.email?.toLowerCase() ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      externalId: input.externalId ?? null,
      stage: input.stage ?? "lead",
      score: 0,
      status: "active",
      customFields: JSON.stringify(input.customFields),
      createdAt: now,
      updatedAt: now,
    });
    return ensureLoaded(await this.getContact(id), "Created contact");
  }

  /**
   * Creates a contact, its selected initial memberships, and the durable
   * contact-created event in one D1 batch. Every relation is checked before
   * the first authoritative write is prepared for execution.
   */
  public async createContactWithInitialRelations(
    input: ContactCreate,
    relations: InitialContactRelations,
  ): Promise<{ contact: Contact; eventId: string }> {
    await this.validateInitialRelations(relations);

    const workspaceId = this.context.workspaceId;
    const id = uuidv7();
    const eventId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    const statements: BatchItem<"sqlite">[] = [
      orm.insert(contacts).values({
        id,
        workspaceId,
        email: input.email?.toLowerCase() ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        externalId: input.externalId ?? null,
        stage: input.stage ?? "lead",
        score: 0,
        status: "active",
        customFields: JSON.stringify(input.customFields),
        createdAt: now,
        updatedAt: now,
      }),
    ];
    if (relations.tagId) {
      statements.push(
        orm.insert(contactTags).values({
          workspaceId,
          contactId: id,
          tagId: relations.tagId,
          createdAt: now,
        }),
      );
    }
    if (relations.segmentId) {
      statements.push(
        orm.insert(segmentMemberships).values({
          workspaceId,
          segmentId: relations.segmentId,
          contactId: id,
          source: "static",
          joinedAt: now,
        }),
      );
    }
    if (relations.companyId) {
      statements.push(
        orm.insert(companyContacts).values({
          workspaceId,
          companyId: relations.companyId,
          contactId: id,
          title: null,
          isPrimary: true,
          createdAt: now,
        }),
      );
    }
    const event = {
      id: eventId,
      workspaceId,
      contactId: id,
      visitorId: null,
      type: "contact_created",
      resourceType: "contact",
      resourceId: id,
      properties: JSON.stringify({}),
      occurredAt: now,
      createdAt: now,
    };
    statements.push(
      orm.insert(contactEvents).values(event),
      orm.insert(contactEventOutbox).values({
        eventId,
        workspaceId,
        status: "pending",
        createdAt: now,
      }),
      orm.insert(contactEventProjections).values(contactEventProjectionRows(event)),
    );

    await orm.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return {
      contact: ensureLoaded(await this.getContact(id), "Created contact"),
      eventId,
    };
  }

  private async validateInitialRelations(relations: InitialContactRelations): Promise<void> {
    const workspaceId = this.context.workspaceId;
    if (relations.tagId) {
      const tag = await this.database.orm
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, relations.tagId)))
        .get();
      if (!tag) throw new ContactRelationInvalidError("tagId");
    }
    if (relations.segmentId) {
      const segment = await this.database.orm
        .select({ id: segments.id })
        .from(segments)
        .where(
          and(
            eq(segments.workspaceId, workspaceId),
            eq(segments.id, relations.segmentId),
            eq(segments.kind, "static"),
          ),
        )
        .get();
      if (!segment) throw new ContactRelationInvalidError("segmentId");
    }
    if (relations.companyId) {
      const company = await this.database.orm
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, relations.companyId)))
        .get();
      if (!company) throw new ContactRelationInvalidError("companyId");
    }
  }

  public async updateContact(id: string, input: ContactUpdate): Promise<Contact | null> {
    const existing = await this.getContact(id);
    if (!existing) return null;
    const fields = {
      email: input.email === undefined ? existing.email : (input.email?.toLowerCase() ?? null),
      firstName: input.firstName === undefined ? existing.firstName : (input.firstName ?? null),
      lastName: input.lastName === undefined ? existing.lastName : (input.lastName ?? null),
      phone: input.phone === undefined ? existing.phone : (input.phone ?? null),
      externalId: input.externalId === undefined ? existing.externalId : (input.externalId ?? null),
      stage: input.stage === undefined ? existing.stage : input.stage,
      customFields: input.customFields === undefined ? existing.customFields : input.customFields,
    };
    await this.database.orm
      .update(contacts)
      .set({
        email: fields.email,
        firstName: fields.firstName,
        lastName: fields.lastName,
        phone: fields.phone,
        externalId: fields.externalId,
        stage: fields.stage,
        customFields: JSON.stringify(fields.customFields),
        updatedAt: nowIso(),
      })
      .where(and(this.inWorkspace(contacts), eq(contacts.id, id)));
    return this.getContact(id);
  }

  /**
   * Archives the contact and scrubs the plaintext email off its email
   * deliveries (channel-scoped: a webhook delivery's `recipient` is an
   * endpoint URL, not PII). `deliveries.payload` can still carry resolved
   * template variables (email, name, ...) independently - out of scope here,
   * see the P9 notes on this.
   */
  public async archiveContact(id: string): Promise<boolean> {
    const now = nowIso();
    const orm = this.database.orm;
    const [updated] = await orm.batch([
      orm
        .update(contacts)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(
          and(this.inWorkspace(contacts), eq(contacts.id, id), ne(contacts.status, "archived")),
        ),
      orm
        .update(deliveries)
        .set({ recipient: null })
        .where(
          and(
            this.inWorkspace(deliveries),
            eq(deliveries.contactId, id),
            eq(deliveries.channel, "email"),
          ),
        ),
    ]);
    return didChange(updated);
  }

  public async restoreContact(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(contacts)
      .set({ status: "active", archivedAt: null, updatedAt: nowIso() })
      .where(and(this.inWorkspace(contacts), eq(contacts.id, id), eq(contacts.status, "archived")));
    return didChange(result);
  }
}

function toContact(row: ContactRow): Contact {
  return contactSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    visitorId: row.visitorId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    externalId: row.externalId,
    stage: row.stage,
    ownerUserId: row.ownerUserId,
    lifecycleStage: row.lifecycleStage,
    score: row.score,
    gradePoints: row.gradePoints,
    status: row.status,
    archivedAt: row.archivedAt,
    customFields: decodeJson(row.customFields, jsonRecordSchema, "contacts.custom_fields"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function compare(column: SQLWrapper, value: string | number, ascending: boolean): SQL {
  return ascending ? gt(column, value) : lt(column, value);
}

function equal(column: SQLWrapper, value: string | number): SQL {
  return sql`${column} = ${value}`;
}
