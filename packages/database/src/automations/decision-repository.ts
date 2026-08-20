import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { contactEvents } from "../contacts/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { automationJobs } from "./schema";

export class AutomationDecisionRepository extends DatabaseRepository {
  /** Decision nodes: has the contact produced this event since this job began? */
  public async hasContactEventSince(
    workspaceId: string,
    contactId: string,
    type: string,
    since: string,
    resourceId: string | null,
  ): Promise<boolean> {
    const conditions = [
      eq(contactEvents.workspaceId, workspaceId),
      eq(contactEvents.contactId, contactId),
      eq(contactEvents.type, type),
      gte(contactEvents.occurredAt, since),
    ];
    if (resourceId !== null) conditions.push(eq(contactEvents.resourceId, resourceId));
    const row = await this.database.orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .where(and(...conditions))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** New matching events make parked decision jobs immediately claimable. */
  public async wakeWaitingDecisionJobs(input: {
    workspaceId: string;
    contactId: string;
    eventType: string;
    resourceId: string | null;
    occurredAt: string;
    now: string;
  }): Promise<void> {
    const resourceMatches =
      input.resourceId === null
        ? isNull(automationJobs.waitResourceId)
        : or(
            isNull(automationJobs.waitResourceId),
            eq(automationJobs.waitResourceId, input.resourceId),
          );
    await this.database.orm
      .update(automationJobs)
      .set({
        dueAt: sql`CASE WHEN ${automationJobs.dueAt} > ${input.now} THEN ${input.now} ELSE ${automationJobs.dueAt} END`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(automationJobs.status, "pending"),
          eq(automationJobs.workspaceId, input.workspaceId),
          eq(automationJobs.contactId, input.contactId),
          eq(automationJobs.waitEventType, input.eventType),
          lte(automationJobs.createdAt, input.occurredAt),
          resourceMatches,
        ),
      );
  }
}
