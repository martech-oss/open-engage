import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";

import type {
  GradingCriterion,
  GradingCriterionWrite,
  ScoringCategory,
  ScoringCategoryWrite,
  ScoringRule,
  ScoringRuleWrite,
} from "@openengage/core/scoring";

import { tags } from "../contacts/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { criterionColumns, criterionSelection, ruleColumns } from "./configuration-values";
import { gradingCriteria, scoringCategories, scoringRules } from "./schema";

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
