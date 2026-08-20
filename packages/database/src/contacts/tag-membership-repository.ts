import { and, eq, exists, inArray, ne, sql, type SQL } from "drizzle-orm";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { contacts, contactTags, tags } from "./schema";

export class ContactTagRepository extends WorkspaceRepository {
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

  public async updateTag(input: {
    id: string;
    name: string;
    slug: string;
    color: string;
  }): Promise<{ id: string; name: string; slug: string; color: string } | null> {
    const existing = await this.database.orm
      .select({ id: tags.id })
      .from(tags)
      .where(and(this.inWorkspace(tags), eq(tags.id, input.id)))
      .get();
    if (!existing) return null;
    await this.database.orm
      .update(tags)
      .set({ name: input.name, slug: input.slug, color: input.color })
      .where(and(this.inWorkspace(tags), eq(tags.id, input.id)));
    return input;
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

  /**
   * Links every non-archived selected contact to the tag, skipping links that
   * already exist. Returns the number of rows actually written.
   */
  public async insertTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
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
  public async deleteTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
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
}
