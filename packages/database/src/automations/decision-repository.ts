import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { type SegmentFilter } from "@openengage/core/segments";

import { contactEvents } from "../contacts/schema";
import { compileWorkspaceSegmentFilter } from "../segments/program-filter-repository";
import { compiledFilterSql } from "../segments/support";
import { DatabaseRepository } from "../shared/repository-base";
import { automationJobs } from "./schema";

export class AutomationDecisionRepository extends DatabaseRepository {
  /** Evaluation and its durable branch commit occur in the same SQL statement. */
  public async captureCondition(
    job: { id: string; workspaceId: string; contactId: string },
    leaseId: string,
    condition: SegmentFilter | boolean,
  ): Promise<"yes" | "no"> {
    const match =
      typeof condition === "boolean"
        ? sql`${condition ? 1 : 0}`
        : sql`EXISTS(SELECT 1 FROM (${compiledFilterSql(compileWorkspaceSegmentFilter(job.workspaceId, condition))}) matched WHERE matched.id=${job.contactId} AND matched.status!='archived')`;
    const row = await this.database.orm
      .update(automationJobs)
      .set({
        payload: sql`json_set(${automationJobs.payload},'$.conditionBranch',coalesce(json_extract(${automationJobs.payload},'$.conditionBranch'),CASE WHEN ${match} THEN 'yes' ELSE 'no' END))`,
      })
      .where(
        and(
          eq(automationJobs.id, job.id),
          eq(automationJobs.workspaceId, job.workspaceId),
          eq(automationJobs.status, "running"),
          eq(automationJobs.leaseId, leaseId),
        ),
      )
      .returning({ payload: automationJobs.payload })
      .get();
    if (!row) throw new Error("Automation condition lease lost");
    return JSON.parse(row.payload).conditionBranch === "yes" ? "yes" : "no";
  }

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
