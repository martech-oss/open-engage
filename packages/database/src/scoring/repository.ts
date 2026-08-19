import { and, asc, eq, exists, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";

import type {
  GradingCriterion,
  GradingCriterionWrite,
  ScoringCategory,
  ScoringCategoryWrite,
  ScoringRule,
  ScoringRuleWrite,
} from "@openengage/core/scoring";

import { contactTags, contacts, tags } from "../contacts/schema";
import { scoreEvents } from "../contacts/score-schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { contactCategoryScores, gradingCriteria, scoringCategories, scoringRules } from "./schema";

/** Authenticated CRUD for categories, rules and grading criteria. */
export class ScoringRepository extends WorkspaceRepository {
  public listCategories(): Promise<ScoringCategory[]> {
    return this.database.orm
      .select({
        id: scoringCategories.id,
        name: scoringCategories.name,
        slug: scoringCategories.slug,
        createdAt: scoringCategories.createdAt,
        updatedAt: scoringCategories.updatedAt,
      })
      .from(scoringCategories)
      .where(and(this.inWorkspace(scoringCategories), isNull(scoringCategories.archivedAt)))
      .orderBy(asc(scoringCategories.name))
      .limit(UNPAGINATED_LIST_LIMIT);
  }

  public async createCategory(input: ScoringCategoryWrite): Promise<{ id: string }> {
    const now = nowIso();
    const id = uuidv7();
    await this.database.orm.insert(scoringCategories).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async archiveCategory(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(scoringCategories)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(scoringCategories),
          eq(scoringCategories.id, id),
          isNull(scoringCategories.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  public async listRules(): Promise<ScoringRule[]> {
    const rows = await this.database.orm
      .select({
        id: scoringRules.id,
        name: scoringRules.name,
        eventType: scoringRules.eventType,
        matchType: scoringRules.matchType,
        matchValue: scoringRules.matchValue,
        points: scoringRules.points,
        categoryId: scoringCategories.id,
        categoryName: scoringCategories.name,
        tagId: tags.id,
        tagName: tags.name,
        enabled: scoringRules.enabled,
        createdAt: scoringRules.createdAt,
        updatedAt: scoringRules.updatedAt,
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
      .where(and(this.inWorkspace(scoringRules), isNull(scoringRules.archivedAt)))
      .orderBy(asc(scoringRules.eventType), asc(scoringRules.name))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows as ScoringRule[];
  }

  public async createRule(input: ScoringRuleWrite): Promise<{ id: string } | null> {
    const now = nowIso();
    const id = uuidv7();
    const result = await this.database.orm.insert(scoringRules).select(
      sql`SELECT
        ${id}, ${this.context.workspaceId}, ${input.name}, ${input.eventType},
        ${input.matchType}, ${input.matchValue}, ${input.points}, ${input.categoryId},
        ${input.tagId}, ${input.enabled}, NULL, ${now}, ${now}
      WHERE ${this.ruleReferencesAreValid(input)}`,
    );
    return result.meta.changes === 1 ? { id } : null;
  }

  public async updateRule(id: string, input: ScoringRuleWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(scoringRules)
      .set({ ...ruleColumns(input), updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(scoringRules),
          eq(scoringRules.id, id),
          isNull(scoringRules.archivedAt),
          this.ruleReferencesAreValid(input),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  public async archiveRule(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(scoringRules)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(scoringRules),
          eq(scoringRules.id, id),
          isNull(scoringRules.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  public listCriteria(): Promise<GradingCriterion[]> {
    return this.database.orm
      .select(criterionSelection)
      .from(gradingCriteria)
      .where(and(this.inWorkspace(gradingCriteria), isNull(gradingCriteria.archivedAt)))
      .orderBy(asc(gradingCriteria.name))
      .limit(UNPAGINATED_LIST_LIMIT) as Promise<GradingCriterion[]>;
  }

  public async createCriterion(input: GradingCriterionWrite): Promise<{ id: string }> {
    const now = nowIso();
    const id = uuidv7();
    await this.database.orm.insert(gradingCriteria).values({
      id,
      workspaceId: this.context.workspaceId,
      ...criterionColumns(input),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateCriterion(id: string, input: GradingCriterionWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(gradingCriteria)
      .set({ ...criterionColumns(input), updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(gradingCriteria),
          eq(gradingCriteria.id, id),
          isNull(gradingCriteria.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  public async archiveCriterion(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(gradingCriteria)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(gradingCriteria),
          eq(gradingCriteria.id, id),
          isNull(gradingCriteria.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  private ruleReferencesAreValid(input: ScoringRuleWrite) {
    const workspaceId = this.context.workspaceId;
    const categoryIsValid =
      input.categoryId === null
        ? sql<boolean>`true`
        : exists(
            this.database.orm
              .select({ id: scoringCategories.id })
              .from(scoringCategories)
              .where(
                and(
                  eq(scoringCategories.workspaceId, workspaceId),
                  eq(scoringCategories.id, input.categoryId),
                  isNull(scoringCategories.archivedAt),
                ),
              ),
          );
    const tagIsValid =
      input.tagId === null
        ? sql<boolean>`true`
        : exists(
            this.database.orm
              .select({ id: tags.id })
              .from(tags)
              .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, input.tagId))),
          );
    return and(categoryIsValid, tagIsValid);
  }
}

const criterionSelection = {
  id: gradingCriteria.id,
  name: gradingCriteria.name,
  field: gradingCriteria.field,
  fieldKey: gradingCriteria.fieldKey,
  operator: gradingCriteria.operator,
  value: gradingCriteria.value,
  steps: gradingCriteria.steps,
  enabled: gradingCriteria.enabled,
  createdAt: gradingCriteria.createdAt,
  updatedAt: gradingCriteria.updatedAt,
};

function ruleColumns(input: ScoringRuleWrite) {
  return {
    name: input.name,
    eventType: input.eventType,
    matchType: input.matchType,
    matchValue: input.matchValue,
    points: input.points,
    categoryId: input.categoryId,
    tagId: input.tagId,
    enabled: input.enabled,
  };
}

function criterionColumns(input: GradingCriterionWrite) {
  return {
    name: input.name,
    field: input.field,
    fieldKey: input.fieldKey,
    operator: input.operator,
    value: input.value,
    steps: input.steps,
    enabled: input.enabled,
  };
}

export interface ScoringRuleMatch {
  id: string;
  name: string;
  matchType: string;
  matchValue: string | null;
  points: number;
  categoryId: string | null;
  tagId: string | null;
}

export interface GradingContactRow {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  stage: string;
  score: number;
  gradePoints: number;
  customFields: string;
}

/**
 * The evaluation side, reached from the event pipeline rather than a session,
 * so the workspace comes from the caller instead of `this.context`.
 */
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
      .limit(UNPAGINATED_LIST_LIMIT);
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
                  WHERE ${notApplied}`,
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
                  WHERE ${notApplied}`,
            )
            .onConflictDoNothing(),
        );
      }
      statements.push(
        orm
          .insert(scoreEvents)
          .values({
            id: uuidv7(),
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            delta: effect.delta,
            reason: `rule:${effect.ruleId}`,
            contactEventId: input.contactEventId,
            scoringRuleId: effect.ruleId,
            createdAt: input.now,
          })
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
      .limit(UNPAGINATED_LIST_LIMIT) as Promise<GradingCriterion[]>;
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
    gradePoints: number,
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({ gradePoints })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .run();
  }
}
