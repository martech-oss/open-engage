import { and, asc, eq, exists, lte, ne, sql } from "drizzle-orm";

import { nextContributionDecay, remainingContribution } from "@openengage/core/scoring";

import { CONTACT_EVENT_PROJECTIONS } from "../contacts/event-repository";
import {
  contacts,
  contactEvents,
  contactEventOutbox,
  contactEventProjections,
} from "../contacts/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { contactCategoryScores, scoreContributions, scoreEvents } from "./schema";

type Contribution = typeof scoreContributions.$inferSelect;

export class ScoringDecayRepository extends DatabaseRepository {
  public listDue(now: string, limit: number): Promise<Contribution[]> {
    return this.database.orm
      .select()
      .from(scoreContributions)
      .where(
        and(
          lte(scoreContributions.nextDecayAt, now),
          exists(
            this.database.orm
              .select({ id: contacts.id })
              .from(contacts)
              .where(
                and(
                  eq(contacts.workspaceId, scoreContributions.workspaceId),
                  eq(contacts.id, scoreContributions.contactId),
                  ne(contacts.status, "archived"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(scoreContributions.nextDecayAt), asc(scoreContributions.id))
      .limit(Math.max(1, Math.min(limit, 100)));
  }

  /** Compare-and-swap and the downstream event outbox share one D1 transaction. */
  public async decay(row: Contribution, now: Date): Promise<string | null> {
    const orm = this.database.orm;
    const remaining = remainingContribution(row.initialScore, row.decayDays, row.occurredAt, now);
    const delta = remaining - row.remainingScore;
    const nextDecayAt =
      remaining > 0 ? nextContributionDecay(row.decayDays, row.occurredAt, now) : null;
    const guard = and(
      eq(scoreContributions.id, row.id),
      eq(scoreContributions.remainingScore, row.remainingScore),
      eq(scoreContributions.nextDecayAt, row.nextDecayAt!),
      exists(
        orm
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, row.workspaceId),
              eq(contacts.id, row.contactId),
              ne(contacts.status, "archived"),
            ),
          ),
      ),
    );
    if (delta >= 0) {
      await orm.update(scoreContributions).set({ nextDecayAt }).where(guard);
      return null;
    }
    const eventId = uuidv7();
    const stamp = now.toISOString();
    const won = exists(
      orm.select({ id: contactEvents.id }).from(contactEvents).where(eq(contactEvents.id, eventId)),
    );
    const statements = [
      orm
        .insert(contactEvents)
        .select(
          sql`SELECT ${eventId}, ${row.workspaceId}, ${row.contactId}, NULL, 'live', 'score_changed', 'scoring_rule', ${row.ruleId}, ${JSON.stringify({ delta, reason: "decay" })}, ${stamp}, NULL, ${stamp} FROM ${scoreContributions} WHERE ${guard}`,
        ),
      ...(row.categoryId
        ? [
            orm
              .update(contactCategoryScores)
              .set({ score: sql`${contactCategoryScores.score} + ${delta}`, updatedAt: stamp })
              .where(
                and(
                  eq(contactCategoryScores.workspaceId, row.workspaceId),
                  eq(contactCategoryScores.contactId, row.contactId),
                  eq(contactCategoryScores.categoryId, row.categoryId),
                  won,
                ),
              ),
          ]
        : []),
      orm
        .update(contacts)
        .set({ score: sql`${contacts.score} + ${delta}`, updatedAt: stamp })
        .where(and(eq(contacts.workspaceId, row.workspaceId), eq(contacts.id, row.contactId), won)),
      orm
        .insert(scoreEvents)
        .select(
          sql`SELECT ${uuidv7()}, ${row.workspaceId}, ${row.contactId}, ${delta}, ${`decay:${row.ruleId}`}, NULL, ${eventId}, NULL, ${stamp} WHERE ${won}`,
        ),
      orm
        .insert(contactEventOutbox)
        .select(
          sql`SELECT ${eventId}, ${row.workspaceId}, 'pending', 0, NULL, NULL, NULL, NULL, ${stamp}, NULL WHERE ${won}`,
        ),
      ...CONTACT_EVENT_PROJECTIONS.map((projection) =>
        orm
          .insert(contactEventProjections)
          .select(
            sql`SELECT ${eventId}, ${row.workspaceId}, ${projection}, 'pending', ${stamp}, NULL WHERE ${won}`,
          ),
      ),
      orm
        .update(scoreContributions)
        .set({ remainingScore: remaining, nextDecayAt })
        .where(and(eq(scoreContributions.id, row.id), won)),
    ];

    const [inserted] = await orm.batch(
      statements as [(typeof statements)[number], ...typeof statements],
    );
    return inserted.meta.changes === 1 ? eventId : null;
  }
}
