import { and, eq, exists, inArray, ne, sql, type SQL } from "drizzle-orm";

import { segmentMemberships, segments } from "../segments/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { contacts } from "./schema";

export class ContactSegmentMembershipRepository extends WorkspaceRepository {
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
   * Joins every non-archived selected contact to a static segment, skipping
   * memberships that already exist. Dynamic segments reject the write.
   * Returns the number of rows actually written.
   */
  public async insertSegmentMemberships(contactFilter: SQL, segmentId: string): Promise<number> {
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
  public async deleteSegmentMemberships(contactFilter: SQL, segmentId: string): Promise<number> {
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
