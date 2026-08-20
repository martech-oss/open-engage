import { and, eq, sql } from "drizzle-orm";

import { contacts, contactTags, tags } from "../contacts/schema";
import { segmentMemberships } from "../segments/schema";
import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { AUTOMATION_CONTACT_COLUMNS, type AutomationContactColumn } from "./engine-support";

export class AutomationContactActionRepository extends DatabaseRepository {
  /** Condition nodes: does the contact carry a tag with this slug? */
  public async contactHasTagWithSlug(
    workspaceId: string,
    contactId: string,
    slug: string,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({ value: sql`1` })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(tags.slug, slug),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** add_tag action: links the tag, keeping an existing link as-is. */
  public async addContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .insert(contactTags)
      .values({ workspaceId, contactId, tagId, createdAt: now })
      .onConflictDoNothing();
  }

  /** remove_tag action: unlinks the tag. */
  public async removeContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(contactTags)
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(contactTags.tagId, tagId),
        ),
      );
  }

  /**
   * add_segment action: joins the contact with source 'automation'. Returns
   * whether a row was written, so the caller can emit `segment_joined` only
   * on a fresh membership.
   */
  public async addAutomationSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(segmentMemberships)
      .values({ workspaceId, segmentId, contactId, source: "automation", joinedAt: now })
      .onConflictDoNothing();
    return changedExactlyOne(result);
  }

  /** remove_segment action: removes the membership regardless of its source. */
  public async removeSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(segmentMemberships)
      .where(
        and(
          eq(segmentMemberships.workspaceId, workspaceId),
          eq(segmentMemberships.segmentId, segmentId),
          eq(segmentMemberships.contactId, contactId),
        ),
      );
  }

  /** update_field action targeting one of the known contact columns. */
  public async updateContactColumn(
    workspaceId: string,
    contactId: string,
    column: AutomationContactColumn,
    value: string,
    now: string,
  ): Promise<void> {
    const assignments: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      stage?: string;
      externalId?: string;
      updatedAt: string;
    } = { updatedAt: now };
    assignments[AUTOMATION_CONTACT_COLUMNS[column]] = value;
    await this.database.orm
      .update(contacts)
      .set(assignments)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  /** update_field action targeting a custom field: stores the merged JSON. */
  public async replaceContactCustomFields(
    workspaceId: string,
    contactId: string,
    customFields: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({ customFields, updatedAt: now })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }
}
