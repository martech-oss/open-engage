import { and, asc, eq, isNull, sql } from "drizzle-orm";

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
        categoryId: scoringRules.categoryId,
        categoryName: scoringCategories.name,
        tagId: scoringRules.tagId,
        tagName: tags.name,
        enabled: scoringRules.enabled,
        createdAt: scoringRules.createdAt,
        updatedAt: scoringRules.updatedAt,
      })
      .from(scoringRules)
      .leftJoin(scoringCategories, eq(scoringCategories.id, scoringRules.categoryId))
      .leftJoin(tags, eq(tags.id, scoringRules.tagId))
      .where(and(this.inWorkspace(scoringRules), isNull(scoringRules.archivedAt)))
      .orderBy(asc(scoringRules.eventType), asc(scoringRules.name))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows as ScoringRule[];
  }

  public async createRule(input: ScoringRuleWrite): Promise<{ id: string }> {
    const now = nowIso();
    const id = uuidv7();
    await this.database.orm.insert(scoringRules).values({
      id,
      workspaceId: this.context.workspaceId,
      ...ruleColumns(input),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
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
        categoryId: scoringRules.categoryId,
        tagId: scoringRules.tagId,
      })
      .from(scoringRules)
      .where(
        and(
          eq(scoringRules.workspaceId, workspaceId),
          eq(scoringRules.eventType, eventType),
          eq(scoringRules.enabled, true),
          isNull(scoringRules.archivedAt),
        ),
      )
      .limit(UNPAGINATED_LIST_LIMIT);
  }

  public async applyScore(input: {
    workspaceId: string;
    contactId: string;
    total: number;
    categoryTotals: Map<string, number>;
    tagIds: string[];
    events: { ruleId: string; delta: number }[];
    now: string;
  }): Promise<void> {
    const orm = this.database.orm;
    const statements = [];
    if (input.total !== 0) {
      statements.push(
        orm
          .update(contacts)
          .set({ score: sql`${contacts.score} + ${input.total}`, updatedAt: input.now })
          .where(
            and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId)),
          ),
      );
    }
    for (const event of input.events) {
      statements.push(
        orm.insert(scoreEvents).values({
          id: uuidv7(),
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          delta: event.delta,
          reason: `rule:${event.ruleId}`,
          createdAt: input.now,
        }),
      );
    }
    for (const [categoryId, delta] of input.categoryTotals) {
      statements.push(
        orm
          .insert(contactCategoryScores)
          .values({
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            categoryId,
            score: delta,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              contactCategoryScores.workspaceId,
              contactCategoryScores.contactId,
              contactCategoryScores.categoryId,
            ],
            set: {
              score: sql`${contactCategoryScores.score} + ${delta}`,
              updatedAt: input.now,
            },
          }),
      );
    }
    for (const tagId of input.tagIds) {
      statements.push(
        orm
          .insert(contactTags)
          .values({
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            tagId,
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
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
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
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
      .run();
  }
}
