import { ScoringRepository } from "@openengage/database/scoring";
import { isConstraintError } from "@openengage/database/shared";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";

export const listCategoriesProcedure = authed.scoring.listCategories.handler(({ context }) =>
  new ScoringRepository(context.database, context.workspace).listCategories(),
);

export const createCategoryProcedure = authed.scoring.createCategory.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await new ScoringRepository(context.database, context.workspace).createCategory(input);
    } catch (error) {
      if (isConstraintError(error)) throw errors.SCORING_CATEGORY_SLUG_TAKEN();
      throw error;
    }
  },
);

export const archiveCategoryProcedure = authed.scoring.archiveCategory.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      !(await new ScoringRepository(context.database, context.workspace).archiveCategory(input.id))
    ) {
      throw errors.SCORING_CATEGORY_NOT_FOUND();
    }
    return ack;
  },
);

export const listRulesProcedure = authed.scoring.listRules.handler(({ context, input }) =>
  new ScoringRepository(context.database, context.workspace).listRules(input),
);

export const createRuleProcedure = authed.scoring.createRule.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const created = await new ScoringRepository(context.database, context.workspace).createRule(
      input,
    );
    if (!created) throw errors.SCORING_RULE_NOT_FOUND();
    return created;
  },
);

export const updateRuleProcedure = authed.scoring.updateRule.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    if (
      !(await new ScoringRepository(context.database, context.workspace).updateRule(id, changes))
    ) {
      throw errors.SCORING_RULE_NOT_FOUND();
    }
    return ack;
  },
);

export const archiveRuleProcedure = authed.scoring.archiveRule.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await new ScoringRepository(context.database, context.workspace).archiveRule(input.id))) {
      throw errors.SCORING_RULE_NOT_FOUND();
    }
    return ack;
  },
);

export const listCriteriaProcedure = authed.scoring.listCriteria.handler(({ context, input }) =>
  new ScoringRepository(context.database, context.workspace).listCriteria(input),
);

export const createCriterionProcedure = authed.scoring.createCriterion.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return new ScoringRepository(context.database, context.workspace).createCriterion(input);
  },
);

export const updateCriterionProcedure = authed.scoring.updateCriterion.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    if (
      !(await new ScoringRepository(context.database, context.workspace).updateCriterion(
        id,
        changes,
      ))
    ) {
      throw errors.GRADING_CRITERION_NOT_FOUND();
    }
    return ack;
  },
);

export const archiveCriterionProcedure = authed.scoring.archiveCriterion.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (
      !(await new ScoringRepository(context.database, context.workspace).archiveCriterion(input.id))
    ) {
      throw errors.GRADING_CRITERION_NOT_FOUND();
    }
    return ack;
  },
);

export const scoringProcedures = {
  listCategories: listCategoriesProcedure,
  createCategory: createCategoryProcedure,
  archiveCategory: archiveCategoryProcedure,
  listRules: listRulesProcedure,
  createRule: createRuleProcedure,
  updateRule: updateRuleProcedure,
  archiveRule: archiveRuleProcedure,
  listCriteria: listCriteriaProcedure,
  createCriterion: createCriterionProcedure,
  updateCriterion: updateCriterionProcedure,
  archiveCriterion: archiveCriterionProcedure,
};
