import * as z from "zod";

/**
 * The behaviours a scoring rule can react to. Every one of these is written to
 * `contact_events` by an existing producer, so a rule never needs a new event
 * pipeline: page views come from the site beacon, opens and clicks from email
 * tracking, redirect clicks from the public redirect route.
 */
export const SCORING_EVENT_TYPES = [
  "page_viewed",
  "form_submitted",
  "email_opened",
  "email_clicked",
  "email_replied",
  "custom_redirect_clicked",
  "custom_event",
] as const;
export const scoringEventTypeSchema = z.enum(SCORING_EVENT_TYPES);
export type ScoringEventType = z.infer<typeof scoringEventTypeSchema>;

/**
 * `resource` compares the event's resource id (a form id, a redirect id, an
 * event name). The `url_*` variants compare the visited URL, which is what
 * turns a `page_viewed` rule into a Page Action.
 */
export const SCORING_MATCH_TYPES = [
  "any",
  "resource",
  "url_exact",
  "url_contains",
  "url_starts_with",
] as const;
export const scoringMatchTypeSchema = z.enum(SCORING_MATCH_TYPES);
export type ScoringMatchType = z.infer<typeof scoringMatchTypeSchema>;

export const GRADING_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
] as const;
export const gradingOperatorSchema = z.enum(GRADING_OPERATORS);
export type GradingOperator = z.infer<typeof gradingOperatorSchema>;

export const GRADING_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "stage",
  "score",
  "custom_field",
] as const;
export const gradingFieldSchema = z.enum(GRADING_FIELDS);
export type GradingField = z.infer<typeof gradingFieldSchema>;

export const scoringCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScoringCategory = z.infer<typeof scoringCategorySchema>;

export const scoringCategoryWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "英小文字、数字、ハイフンで入力してください")
    .max(191),
});
export type ScoringCategoryWrite = z.infer<typeof scoringCategoryWriteSchema>;

export const scoringRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  eventType: scoringEventTypeSchema,
  matchType: scoringMatchTypeSchema,
  matchValue: z.string().nullable(),
  points: z.number().int(),
  decayDays: z.number().int().nullable(),
  maxScore: z.number().int().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  tagId: z.string().nullable(),
  tagName: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export const scoringRuleWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    eventType: scoringEventTypeSchema,
    matchType: scoringMatchTypeSchema.default("any"),
    matchValue: z.string().trim().max(2_000).nullable().default(null),
    points: z.number().int().min(-1_000).max(1_000),
    decayDays: z.number().int().min(1).max(3650).nullable().default(null),
    maxScore: z.number().int().min(1).max(1_000_000).nullable().default(null),
    categoryId: z.string().min(1).nullable().default(null),
    tagId: z.string().min(1).nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .refine((rule) => rule.points > 0 || (rule.decayDays === null && rule.maxScore === null), {
    path: ["points"],
    message: "減衰・上限は正の加点ルールにのみ設定できます",
  })
  .refine((rule) => rule.matchType === "any" || Boolean(rule.matchValue?.trim()), {
    path: ["matchValue"],
    message: "一致条件を指定した場合は値が必要です",
  })
  .refine((rule) => rule.points !== 0 || Boolean(rule.tagId), {
    path: ["points"],
    message: "点数かタグのどちらかを設定してください",
  });
export type ScoringRuleWrite = Omit<
  z.infer<typeof scoringRuleWriteSchema>,
  "decayDays" | "maxScore"
> & { decayDays?: number | null; maxScore?: number | null };

export const gradingCriterionSchema = z.object({
  id: z.string(),
  name: z.string(),
  field: gradingFieldSchema,
  fieldKey: z.string().nullable(),
  operator: gradingOperatorSchema,
  value: z.string(),
  steps: z.number().int(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GradingCriterion = z.infer<typeof gradingCriterionSchema>;

export const gradingCriterionWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    field: gradingFieldSchema,
    fieldKey: z.string().trim().max(191).nullable().default(null),
    operator: gradingOperatorSchema,
    value: z.string().trim().max(2_000).default(""),
    /** Thirds of a letter, so ±3 is a whole grade in either direction. */
    steps: z.number().int().min(-6).max(6),
    enabled: z.boolean().default(true),
  })
  .refine(
    (criterion) => criterion.field !== "custom_field" || Boolean(criterion.fieldKey?.trim()),
    {
      path: ["fieldKey"],
      message: "カスタムフィールドはキーが必要です",
    },
  );
export type GradingCriterionWrite = z.infer<typeof gradingCriterionWriteSchema>;

export const contactCategoryScoreSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  score: z.number().int(),
});
export type ContactCategoryScore = z.infer<typeof contactCategoryScoreSchema>;

/** Administrative pages are separate from the complete runtime configuration. */
export const scoringPageInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ScoringPageInput = z.input<typeof scoringPageInputSchema>;
export const scoringRulePageSchema = z.object({
  items: z.array(scoringRuleSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
  summary: z.object({ enabled: z.number(), pageActions: z.number() }),
});
export type ScoringRulePage = z.infer<typeof scoringRulePageSchema>;
export const gradingCriterionPageSchema = z.object({
  items: z.array(gradingCriterionSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
  summary: z.object({ enabled: z.number(), totalSteps: z.number() }),
});
export type GradingCriterionPage = z.infer<typeof gradingCriterionPageSchema>;
