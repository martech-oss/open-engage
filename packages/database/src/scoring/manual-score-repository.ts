import { and, eq, ne, sql } from "drizzle-orm";

import { contacts } from "../contacts/schema";
import { didChange, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { scoreEvents } from "./schema";

export class ManualScoringRepository extends WorkspaceRepository {
  /**
   * Applies the delta and records a score event, atomically. Returns false
   * when the contact is missing or archived, in which case nothing is
   * written - the score event insert is itself an insert-from-select scoped
   * to the same filter, so it naturally no-ops alongside the update.
   */
  public async adjustContactScore(
    contactId: string,
    input: { delta: number; reason: string },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const now = nowIso();
    const orm = this.database.orm;
    const contactFilter = and(
      eq(contacts.workspaceId, workspaceId),
      eq(contacts.id, contactId),
      ne(contacts.status, "archived"),
    );
    const [updated] = await orm.batch([
      orm
        .update(contacts)
        .set({ score: sql`${contacts.score} + ${input.delta}`, updatedAt: now })
        .where(contactFilter),
      orm.insert(scoreEvents).select(
        orm
          .select({
            id: sql<string>`${uuidv7()}`.as("id"),
            workspaceId: contacts.workspaceId,
            contactId: contacts.id,
            delta: sql<number>`${input.delta}`.as("delta"),
            reason: sql<string>`${input.reason}`.as("reason"),
            automationEnrollmentId: sql<string | null>`null`.as("automation_enrollment_id"),
            contactEventId: sql<string | null>`null`.as("contact_event_id"),
            scoringRuleId: sql<string | null>`null`.as("scoring_rule_id"),
            createdAt: sql<string>`${now}`.as("created_at"),
          })
          .from(contacts)
          .where(contactFilter),
      ),
    ]);
    return didChange(updated);
  }
}
