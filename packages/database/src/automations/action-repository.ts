import { and, eq, ne, notExists, sql } from "drizzle-orm";

import { contacts } from "../contacts/schema";
import { scoreEvents } from "../contacts/score-schema";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import type { AutomationJobRow } from "./engine-support";
import { automationActionEffects } from "./schema";

/** Atomic ledgers for automation actions whose effects are not naturally idempotent. */
export class AutomationActionRepository extends DatabaseRepository {
  public async adjustContactScoreForJob(
    job: Pick<AutomationJobRow, "id" | "workspaceId" | "contactId" | "enrollmentId" | "nodeId">,
    amount: number,
    now: string,
  ): Promise<void> {
    const orm = this.database.orm;
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
    await orm.batch([
      orm
        .update(contacts)
        .set({ score: sql`${contacts.score} + ${amount}`, updatedAt: now })
        .where(
          and(
            eq(contacts.workspaceId, job.workspaceId),
            eq(contacts.id, job.contactId),
            ne(contacts.status, "archived"),
            unapplied,
          ),
        ),
      orm.insert(scoreEvents).select(
        sql`SELECT ${uuidv7()}, ${job.workspaceId}, ${job.contactId}, ${amount}, 'automation',
                   ${job.enrollmentId}, NULL, NULL, ${now}
            WHERE ${unapplied}
              AND EXISTS (
                SELECT 1 FROM ${contacts}
                WHERE ${contacts.workspaceId} = ${job.workspaceId}
                  AND ${contacts.id} = ${job.contactId}
                  AND ${contacts.status} != 'archived'
              )`,
      ),
      orm
        .insert(automationActionEffects)
        .values({
          workspaceId: job.workspaceId,
          jobId: job.id,
          nodeId: job.nodeId,
          effect: "change_score",
          completedAt: now,
        })
        .onConflictDoNothing(),
    ]);
  }
}
