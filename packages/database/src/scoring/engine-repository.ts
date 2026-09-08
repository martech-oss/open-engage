import { asc, and, eq, exists, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";

import type { GradingCriterion } from "@openengage/core/scoring";

import { contactTags, contacts, tags } from "../contacts/schema";
import { changedExactlyOne } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { criterionSelection } from "./configuration-values";
import {
  contactCategoryScores,
  gradingCriteria,
  scoreEvents,
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
      categoryId: string | null;
      tagId: string | null;
    }>;
    now: string;
  }): Promise<void> {
    for (let offset = 0; offset < input.effects.length; offset += 50) {
      await this.applyScoreBatch({ ...input, effects: input.effects.slice(offset, offset + 50) });
    }
  }

  private async applyScoreBatch(
    input: Parameters<ScoringEngineRepository["applyScore"]>[0],
  ): Promise<void> {
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
    if (!activeContact) return;
    const statements = [];
    for (const effect of input.effects) {
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
            .set({ score: sql`${contacts.score} + ${effect.delta}`, updatedAt: input.now })
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
                         ${effect.delta}, ${input.now}
                  WHERE ${notApplied} AND ${contactIsProcessable}`,
            )
            .onConflictDoUpdate({
              target: [
                contactCategoryScores.workspaceId,
                contactCategoryScores.contactId,
                contactCategoryScores.categoryId,
              ],
              set: {
                score: sql`${contactCategoryScores.score} + ${effect.delta}`,
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
            sql`SELECT ${uuidv7()}, ${input.workspaceId}, ${input.contactId}, ${effect.delta},
                       ${`rule:${effect.ruleId}`}, NULL, ${input.contactEventId},
                       ${effect.ruleId}, ${input.now}
                WHERE ${notApplied} AND ${contactIsProcessable}`,
          )
          .onConflictDoNothing(),
      );
    }
    if (statements.length === 0) return;
    await orm.batch(statements as [(typeof statements)[number], ...typeof statements]);
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
