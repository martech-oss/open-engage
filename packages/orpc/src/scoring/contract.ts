import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  gradingCriterionSchema,
  gradingCriterionWriteSchema,
  scoringCategorySchema,
  scoringCategoryWriteSchema,
  scoringRuleSchema,
  scoringRuleWriteSchema,
} from "@openengage/core/scoring";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput, notFoundError } from "../shared/schemas";

const created = z.object({ id: z.string() });
const categoryTaken = {
  SCORING_CATEGORY_SLUG_TAKEN: { status: 409, message: "同じスラッグのカテゴリが既に存在します" },
} as const;
const ruleNotFound = {
  ...authedErrors,
  ...notFoundError("SCORING_RULE_NOT_FOUND", "スコアリングルールが見つかりません"),
} as const;
const criterionNotFound = {
  ...authedErrors,
  ...notFoundError("GRADING_CRITERION_NOT_FOUND", "グレード条件が見つかりません"),
} as const;

export const scoringContract = {
  listCategories: oc
    .route({ method: "GET", path: "/scoring/categories" })
    .errors(workspaceErrors)
    .output(z.array(scoringCategorySchema)),
  createCategory: oc
    .route({ method: "POST", path: "/scoring/categories", successStatus: 201 })
    .errors({ ...authedErrors, ...categoryTaken })
    .input(scoringCategoryWriteSchema)
    .output(created),
  archiveCategory: oc
    .route({ method: "POST", path: "/scoring/categories/{id}/archive" })
    .errors({
      ...authedErrors,
      ...notFoundError("SCORING_CATEGORY_NOT_FOUND", "カテゴリが見つかりません"),
    })
    .input(idInput)
    .output(ackSchema),

  listRules: oc
    .route({ method: "GET", path: "/scoring/rules" })
    .errors(workspaceErrors)
    .output(z.array(scoringRuleSchema)),
  createRule: oc
    .route({ method: "POST", path: "/scoring/rules", successStatus: 201 })
    .errors(authedErrors)
    .input(scoringRuleWriteSchema)
    .output(created),
  updateRule: oc
    .route({ method: "PATCH", path: "/scoring/rules/{id}" })
    .errors(ruleNotFound)
    .input(scoringRuleWriteSchema.safeExtend({ id: z.string().min(1) }))
    .output(ackSchema),
  archiveRule: oc
    .route({ method: "POST", path: "/scoring/rules/{id}/archive" })
    .errors(ruleNotFound)
    .input(idInput)
    .output(ackSchema),

  listCriteria: oc
    .route({ method: "GET", path: "/scoring/grading-criteria" })
    .errors(workspaceErrors)
    .output(z.array(gradingCriterionSchema)),
  createCriterion: oc
    .route({ method: "POST", path: "/scoring/grading-criteria", successStatus: 201 })
    .errors(authedErrors)
    .input(gradingCriterionWriteSchema)
    .output(created),
  updateCriterion: oc
    .route({ method: "PATCH", path: "/scoring/grading-criteria/{id}" })
    .errors(criterionNotFound)
    .input(gradingCriterionWriteSchema.safeExtend({ id: z.string().min(1) }))
    .output(ackSchema),
  archiveCriterion: oc
    .route({ method: "POST", path: "/scoring/grading-criteria/{id}/archive" })
    .errors(criterionNotFound)
    .input(idInput)
    .output(ackSchema),
};
