import { and, eq, sql } from "drizzle-orm";

import { contacts, contactTags, tags } from "../contacts/schema";
import { segmentMemberships } from "../segments/schema";
import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { runningActionLeaseExists } from "./action-authority";
import {
  AUTOMATION_CONTACT_COLUMNS,
  type AutomationContactColumn,
  type AutomationJobRow,
} from "./engine-support";

type ContactActionJob = Pick<AutomationJobRow, "id" | "workspaceId" | "contactId">;

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
    job: ContactActionJob,
    leaseId: string,
    tagId: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .insert(contactTags)
      .select(
        sql`SELECT ${job.workspaceId}, ${job.contactId}, ${tagId}, ${now}
            WHERE ${runningActionLeaseExists(this.database, {
              jobId: job.id,
              workspaceId: job.workspaceId,
              leaseId,
            })}`,
      )
      .onConflictDoNothing();
  }

  /** remove_tag action: unlinks the tag. */
  public async removeContactTag(
    job: ContactActionJob,
    leaseId: string,
    tagId: string,
  ): Promise<void> {
    await this.database.orm.delete(contactTags).where(
      and(
        eq(contactTags.workspaceId, job.workspaceId),
        eq(contactTags.contactId, job.contactId),
        eq(contactTags.tagId, tagId),
        runningActionLeaseExists(this.database, {
          jobId: job.id,
          workspaceId: job.workspaceId,
          leaseId,
        }),
      ),
    );
  }

  /**
   * add_segment action: joins the contact with source 'automation'. Returns
   * whether a row was written, so the caller can emit `segment_joined` only
   * on a fresh membership.
   */
  public async addAutomationSegmentMembership(
    job: ContactActionJob,
    leaseId: string,
    segmentId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(segmentMemberships)
      .select(
        sql`SELECT ${job.workspaceId}, ${segmentId}, ${job.contactId}, 'automation', ${now}
            WHERE ${runningActionLeaseExists(this.database, {
              jobId: job.id,
              workspaceId: job.workspaceId,
              leaseId,
            })}`,
      )
      .onConflictDoNothing();
    return changedExactlyOne(result);
  }

  /** remove_segment action: removes the membership regardless of its source. */
  public async removeSegmentMembership(
    job: ContactActionJob,
    leaseId: string,
    segmentId: string,
  ): Promise<void> {
    await this.database.orm.delete(segmentMemberships).where(
      and(
        eq(segmentMemberships.workspaceId, job.workspaceId),
        eq(segmentMemberships.segmentId, segmentId),
        eq(segmentMemberships.contactId, job.contactId),
        runningActionLeaseExists(this.database, {
          jobId: job.id,
          workspaceId: job.workspaceId,
          leaseId,
        }),
      ),
    );
  }

  /** update_field action targeting one of the known contact columns. */
  public async updateContactColumn(
    job: ContactActionJob,
    leaseId: string,
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
      .where(
        and(
          eq(contacts.workspaceId, job.workspaceId),
          eq(contacts.id, job.contactId),
          runningActionLeaseExists(this.database, {
            jobId: job.id,
            workspaceId: job.workspaceId,
            leaseId,
          }),
        ),
      );
  }

  /** update_field action targeting a custom field: stores the merged JSON. */
  public async replaceContactCustomFields(
    job: ContactActionJob,
    leaseId: string,
    customFields: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({ customFields, updatedAt: now })
      .where(
        and(
          eq(contacts.workspaceId, job.workspaceId),
          eq(contacts.id, job.contactId),
          runningActionLeaseExists(this.database, {
            jobId: job.id,
            workspaceId: job.workspaceId,
            leaseId,
          }),
        ),
      );
  }
}
