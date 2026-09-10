import {
  inArray,
  asc,
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { nextContributionDecay, type GradingCriterion } from "@openengage/core/scoring";

import { contactEvents, contactTags, contacts, tags } from "../contacts/schema";
import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { criterionSelection } from "./configuration-values";
import {
  contactCategoryScores,
  gradingCriteria,
  scoreEvents,
  scoreContributions,
  scoringCategories,
  scoringRules,
} from "./schema";
import type { GradingContactRow, ScoringRuleMatch } from "./types";

export class ScoringEngineRepository extends DatabaseRepository {
  public listEnabledRules(workspaceId: string, eventType: string): Promise<ScoringRuleMatch[]> {
    return this.database.orm
      .select({
        id: scoringRules.id,
        name: scoringRules.name,
        matchType: scoringRules.matchType,
        matchValue: scoringRules.matchValue,
        points: scoringRules.points,
        decayDays: scoringRules.decayDays,
        maxScore: scoringRules.maxScore,
        categoryId: scoringCategories.id,
        tagId: tags.id,
      })
      .from(scoringRules)
      .leftJoin(
        scoringCategories,
        and(
          eq(scoringCategories.workspaceId, scoringRules.workspaceId),
          eq(scoringCategories.id, scoringRules.categoryId),
          isNull(scoringCategories.archivedAt),
        ),
      )
      .leftJoin(
        tags,
        and(eq(tags.workspaceId, scoringRules.workspaceId), eq(tags.id, scoringRules.tagId)),
      )
      .where(
        and(
          eq(scoringRules.workspaceId, workspaceId),
          eq(scoringRules.eventType, eventType),
          eq(scoringRules.enabled, true),
          isNull(scoringRules.archivedAt),
          or(isNull(scoringRules.categoryId), isNotNull(scoringCategories.id)),
          or(isNull(scoringRules.tagId), isNotNull(tags.id)),
        ),
      )
      .orderBy(asc(scoringRules.id));
  }

  public async applyScore(input: {
    workspaceId: string;
    contactId: string;
    contactEventId: string;
    effects: Array<{
      ruleId: string;
      delta: number;
      decayDays?: number | null;
      maxScore?: number | null;
      categoryId: string | null;
      tagId: string | null;
    }>;
    now: string;
  }): Promise<number> {
    let total = 0;
    for (let offset = 0; offset < input.effects.length; offset += 50) {
      total += await this.applyScoreBatch({
        ...input,
        effects: input.effects.slice(offset, offset + 50),
      });
    }
    return total;
  }

  private async applyScoreBatch(
    input: Parameters<ScoringEngineRepository["applyScore"]>[0],
  ): Promise<number> {
    const orm = this.database.orm;
    const activeContact = await orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, input.workspaceId),
          eq(contacts.id, input.contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    if (!activeContact) return 0;
    const event = await orm
      .select({ occurredAt: contactEvents.occurredAt })
      .from(contactEvents)
      .where(
        and(
          eq(contactEvents.id, input.contactEventId),
          eq(contactEvents.workspaceId, input.workspaceId),
          eq(contactEvents.contactId, input.contactId),
        ),
      )
      .get();
    if (!event) return 0;
    const statements = [];
    const appliedIds: string[] = [];
    for (const effect of input.effects) {
      const contributionId = uuidv7();
      appliedIds.push(contributionId);
      const initial =
        effect.delta > 0 && effect.maxScore != null
          ? sql`min(${effect.delta}, max(0, ${effect.maxScore} - (SELECT coalesce(sum(${scoreContributions.remainingScore}), 0) FROM ${scoreContributions} WHERE ${scoreContributions.workspaceId} = ${input.workspaceId} AND ${scoreContributions.contactId} = ${input.contactId} AND ${scoreContributions.ruleId} = ${effect.ruleId})))`
          : sql`${effect.delta}`;

      const elapsed = Math.max(
        0,
        Math.floor((Date.parse(input.now) - Date.parse(event.occurredAt)) / 86400000),
      );
      const available =
        effect.delta > 0 && effect.decayDays != null
          ? sql`cast(${initial} * ${Math.max(0, effect.decayDays - elapsed)} / ${effect.decayDays} as integer)`
          : initial;
      const nextDecayAt = nextContributionDecay(
        effect.decayDays ?? null,
        event.occurredAt,
        new Date(input.now),
      );
      const contactIsProcessable = exists(
        orm
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, input.workspaceId),
              eq(contacts.id, input.contactId),
              ne(contacts.status, "archived"),
            ),
          ),
      );
      const notApplied = notExists(
        orm
          .select({ id: scoreEvents.id })
          .from(scoreEvents)
          .where(
            and(
              eq(scoreEvents.workspaceId, input.workspaceId),
              eq(scoreEvents.contactEventId, input.contactEventId),
              eq(scoreEvents.scoringRuleId, effect.ruleId),
            ),
          ),
      );
      if (effect.delta !== 0) {
        statements.push(
          orm
            .update(contacts)
            .set({ score: sql`${contacts.score} + ${available}`, updatedAt: input.now })
            .where(
              and(
                eq(contacts.workspaceId, input.workspaceId),
                eq(contacts.id, input.contactId),
                ne(contacts.status, "archived"),
                notApplied,
              ),
            ),
        );
      }
      if (effect.categoryId && effect.delta !== 0) {
        statements.push(
          orm
            .insert(contactCategoryScores)
            .select(
              sql`SELECT ${input.workspaceId}, ${input.contactId}, ${effect.categoryId},
                         ${available}, ${input.now}
                  WHERE ${notApplied} AND ${contactIsProcessable}`,
            )
            .onConflictDoUpdate({
              target: [
                contactCategoryScores.workspaceId,
                contactCategoryScores.contactId,
                contactCategoryScores.categoryId,
              ],
              set: {
                score: sql`${contactCategoryScores.score} + ${available}`,
                updatedAt: input.now,
              },
            }),
        );
      }
      if (effect.tagId) {
        statements.push(
          orm
            .insert(contactTags)
            .select(
              sql`SELECT ${input.workspaceId}, ${input.contactId}, ${effect.tagId}, ${input.now}
                  WHERE ${notApplied} AND ${contactIsProcessable}`,
            )
            .onConflictDoNothing(),
        );
      }
      statements.push(
        orm
          .insert(scoreEvents)
          .select(
            sql`SELECT ${contributionId}, ${input.workspaceId}, ${input.contactId}, ${available},
                       ${`rule:${effect.ruleId}`}, NULL, ${input.contactEventId},
                       ${effect.ruleId}, ${input.now}
                WHERE ${notApplied} AND ${contactIsProcessable}`,
          )
          .onConflictDoNothing(),
      );
      if (effect.delta > 0) {
        // Capture the actual capped amount from the just-written score event.
        // Its generated id also identifies whether this batch won the replay race.
        statements.push(
          orm.insert(scoreContributions).select(sql`
          SELECT ${contributionId}, ${input.workspaceId}, ${input.contactId}, ${effect.ruleId},
            ${effect.categoryId}, ${initial}, delta, ${effect.decayDays ?? null},
            ${event.occurredAt}, CASE WHEN delta > 0 THEN ${nextDecayAt} ELSE NULL END
          FROM ${scoreEvents} WHERE ${scoreEvents.id} = ${contributionId}`),
        );
      }
    }
    if (statements.length === 0) return 0;
    await orm.batch(statements as [(typeof statements)[number], ...typeof statements]);
    const result = await orm
      .select({ total: sql<number>`coalesce(sum(${scoreEvents.delta}),0)`.mapWith(Number) })
      .from(scoreEvents)
      .where(inArray(scoreEvents.id, appliedIds))
      .get();
    return result?.total ?? 0;
  }

  public listEnabledCriteria(workspaceId: string): Promise<GradingCriterion[]> {
    return this.database.orm
      .select(criterionSelection)
      .from(gradingCriteria)
      .where(
        and(
          eq(gradingCriteria.workspaceId, workspaceId),
          eq(gradingCriteria.enabled, true),
          isNull(gradingCriteria.archivedAt),
        ),
      )
      .orderBy(asc(gradingCriteria.id)) as Promise<GradingCriterion[]>;
  }

  public async readGradingContact(
    workspaceId: string,
    contactId: string,
  ): Promise<GradingContactRow | null> {
    const row = await this.database.orm
      .select({
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        stage: contacts.stage,
        score: contacts.score,
        gradePoints: contacts.gradePoints,
        customFields: contacts.customFields,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row ?? null;
  }

  public async setGradePoints(
    workspaceId: string,
    contactId: string,
    expected: GradingContactRow,
    gradePoints: number,
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(contacts)
      .set({ gradePoints })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
          expected.email === null ? isNull(contacts.email) : eq(contacts.email, expected.email),
          expected.firstName === null
            ? isNull(contacts.firstName)
            : eq(contacts.firstName, expected.firstName),
          expected.lastName === null
            ? isNull(contacts.lastName)
            : eq(contacts.lastName, expected.lastName),
          expected.phone === null ? isNull(contacts.phone) : eq(contacts.phone, expected.phone),
          eq(contacts.stage, expected.stage),
          eq(contacts.score, expected.score),
          eq(contacts.gradePoints, expected.gradePoints),
          eq(contacts.customFields, expected.customFields),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }
}
