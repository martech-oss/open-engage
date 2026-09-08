import { and, eq, exists, ne, notExists, isNull, sql } from "drizzle-orm";

import { contacts } from "../contacts/schema";
import { scoreEvents, contactCategoryScores, scoringCategories } from "../scoring/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { runningActionLeaseExists } from "./action-authority";
import type { AutomationJobRow } from "./engine-support";
import { automationActionEffects, automationJobs } from "./schema";

/** Atomic ledgers for automation actions whose effects are not naturally idempotent. */
export class AutomationActionRepository extends DatabaseRepository {
  public async adjustContactScoreForJob(
    job: Pick<AutomationJobRow, "id" | "workspaceId" | "contactId" | "enrollmentId" | "nodeId">,
    leaseId: string,
    amount: number,
    now: string,
    options: { operation?: "add" | "set" | undefined; categoryId?: string | undefined } = {},
  ): Promise<void> {
    const orm = this.database.orm;
    const authority = runningActionLeaseExists(this.database, {
      jobId: job.id,
      workspaceId: job.workspaceId,
      leaseId,
    });
    const unapplied = notExists(
      orm
        .select({ jobId: automationActionEffects.jobId })
        .from(automationActionEffects)
        .where(
          and(
            eq(automationActionEffects.jobId, job.id),
            eq(automationActionEffects.nodeId, job.nodeId),
            eq(automationActionEffects.effect, "change_score"),
          ),
        ),
    );
    const categoryId = options.categoryId;
    if (categoryId) {
      const category = await orm
        .select({ id: scoringCategories.id })
        .from(scoringCategories)
        .where(
          and(
            eq(scoringCategories.workspaceId, job.workspaceId),
            eq(scoringCategories.id, categoryId),
            isNull(scoringCategories.archivedAt),
          ),
        )
        .get();
      if (!category) throw new Error("Scoring category unavailable");
    }
    const current = categoryId
      ? sql`coalesce((SELECT score FROM ${contactCategoryScores} WHERE workspace_id=${job.workspaceId} AND contact_id=${job.contactId} AND category_id=${categoryId}),0)`
      : sql`(SELECT score FROM ${contacts} WHERE workspace_id=${job.workspaceId} AND id=${job.contactId})`;
    const delta = options.operation === "set" ? sql`${amount}-${current}` : sql`${amount}`;
    const activeContact = exists(
      orm
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, job.workspaceId),
            eq(contacts.id, job.contactId),
            ne(contacts.status, "archived"),
          ),
        ),
    );
    const guard = and(unapplied, authority, activeContact)!;
    await orm.batch([
      // Capture the delta before changing the score, in the same atomic transaction.
      orm
        .insert(scoreEvents)
        .select(
          sql`SELECT ${uuidv7()},${job.workspaceId},${job.contactId},${delta},${categoryId ? `automation:category:${categoryId}` : "automation"},${job.enrollmentId},NULL,NULL,${now} WHERE ${guard}`,
        ),
      ...(categoryId
        ? [
            orm
              .insert(contactCategoryScores)
              .select(
                sql`SELECT ${job.workspaceId},${job.contactId},${categoryId},${amount},${now} WHERE ${guard}`,
              )
              .onConflictDoUpdate({
                target: [
                  contactCategoryScores.workspaceId,
                  contactCategoryScores.contactId,
                  contactCategoryScores.categoryId,
                ],
                set: {
                  score:
                    options.operation === "set"
                      ? sql`${amount}`
                      : sql`${contactCategoryScores.score}+${amount}`,
                  updatedAt: now,
                },
              }),
          ]
        : [
            orm
              .update(contacts)
              .set({
                score:
                  options.operation === "set" ? sql`${amount}` : sql`${contacts.score}+${amount}`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(contacts.workspaceId, job.workspaceId),
                  eq(contacts.id, job.contactId),
                  guard,
                ),
              ),
          ]),
      orm
        .insert(automationActionEffects)
        .select(
          sql`SELECT ${job.workspaceId},${job.id},${job.nodeId},'change_score',${now} WHERE ${guard}`,
        )
        .onConflictDoNothing(),
    ]);
  }

  public async hasRunningLease(
    job: Pick<AutomationJobRow, "id" | "workspaceId">,
    leaseId: string,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: automationJobs.id })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.id, job.id),
          eq(automationJobs.workspaceId, job.workspaceId),
          eq(automationJobs.status, "running"),
          eq(automationJobs.leaseId, leaseId),
        ),
      )
      .get();
    return row !== undefined;
  }
}
