import { and, asc, eq, notExists, isNull, sql } from "drizzle-orm";

import { contactEvents, contacts } from "../contacts/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { automationEnrollments, automations, automationTriggers } from "./schema";

export class AutomationInactivityRepository extends DatabaseRepository {
  /**
   * Cross-workspace scan for 'contact_inactive' triggers: active contacts of
   * active automations whose latest event (or creation) is at least
   * `inactivity_days` before `now`, excluding contacts already enrolled via
   * the "once" sentinel.
   */
  public async listInactiveEnrollmentCandidates(
    now: string,
    limit: number,
  ): Promise<
    Array<{
      automationVersionId: string;
      automationId: string;
      sourceNodeId: string;
      reentry: string;
      workspaceId: string;
      contactId: string;
      lastActivityAt: string;
    }>
  > {
    const orm = this.database.orm;
    const lastActivity = sql<string>`COALESCE((SELECT MAX(${contactEvents.occurredAt}) FROM ${contactEvents} WHERE ${contactEvents.workspaceId}=${contacts.workspaceId} AND ${contactEvents.contactId}=${contacts.id}),${contacts.createdAt})`;
    return await orm
      .select({
        automationVersionId: automationTriggers.automationVersionId,
        automationId: automationTriggers.automationId,
        sourceNodeId: automationTriggers.sourceNodeId,
        reentry: automationTriggers.reentry,
        workspaceId: contacts.workspaceId,
        contactId: contacts.id,
        lastActivityAt: lastActivity,
      })
      .from(automationTriggers)
      .innerJoin(
        automations,
        and(
          eq(automations.workspaceId, automationTriggers.workspaceId),
          eq(automations.id, automationTriggers.automationId),
        ),
      )
      .innerJoin(contacts, eq(contacts.workspaceId, automationTriggers.workspaceId))
      .where(
        and(
          eq(automationTriggers.source, "contact_inactive"),
          eq(automations.status, "active"),
          eq(automations.publishedVersionId, automationTriggers.automationVersionId),
          eq(contacts.status, "active"),
          sql`julianday(COALESCE((
            SELECT MAX(${contactEvents.occurredAt}) FROM ${contactEvents}
            WHERE ${contactEvents.workspaceId} = ${contacts.workspaceId}
              AND ${contactEvents.contactId} = ${contacts.id}
          ), ${contacts.createdAt})) <= julianday(${now}) - ${automationTriggers.inactivityDays}`,
          notExists(
            orm
              .select({ value: sql`1` })
              .from(automationEnrollments)
              .where(
                and(
                  eq(automationEnrollments.workspaceId, automationTriggers.workspaceId),
                  eq(automationEnrollments.automationId, automationTriggers.automationId),
                  eq(automationEnrollments.contactId, contacts.id),
                  isNull(automationEnrollments.parentJobId),
                  sql`(${automationTriggers.reentry}='once' OR ${automationEnrollments.sourceEventId}=('inactive:' || ${automationTriggers.automationId} || ':' || ${contacts.id} || ':' || ${lastActivity}))`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(contacts.updatedAt))
      .limit(limit);
  }
}
