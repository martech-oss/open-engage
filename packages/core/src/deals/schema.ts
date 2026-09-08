import * as z from "zod";

const dealStatusSchema = z.enum(["open", "won", "lost"]);
export type DealStatus = z.infer<typeof dealStatusSchema>;

const dealTaskTypeSchema = z.enum(["task", "call", "email", "meeting"]);
export type DealTaskType = z.infer<typeof dealTaskTypeSchema>;

const dealTaskStatusSchema = z.enum(["open", "completed"]);
export type DealTaskStatus = z.infer<typeof dealTaskStatusSchema>;

const nullableIdSchema = z.string().min(1).nullable().optional();

const dealFieldsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  status: dealStatusSchema,
  ownerUserId: nullableIdSchema,
  contactId: nullableIdSchema,
  companyId: nullableIdSchema,
  expectedCloseDate: z.iso.date().nullable().optional(),
  description: z.string().trim().max(10_000),
});

export const dealCreateSchema = dealFieldsSchema.extend({
  value: dealFieldsSchema.shape.value.default(0),
  currency: dealFieldsSchema.shape.currency.default("JPY"),
  status: dealFieldsSchema.shape.status.default("open"),
  description: dealFieldsSchema.shape.description.default(""),
});
export type DealCreate = z.infer<typeof dealCreateSchema>;

export const dealUpdateSchema = dealFieldsSchema.partial();
export type DealUpdate = z.infer<typeof dealUpdateSchema>;

export const dealMoveSchema = z.object({
  stageId: z.string().min(1),
});
export type DealMove = z.infer<typeof dealMoveSchema>;

const dealTaskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(191),
  type: dealTaskTypeSchema,
  notes: z.string().trim().max(10_000),
  dueAt: z.iso.datetime().nullable().optional(),
  assignedUserId: nullableIdSchema,
});

export const dealTaskCreateSchema = dealTaskFieldsSchema.extend({
  type: dealTaskFieldsSchema.shape.type.default("task"),
  notes: dealTaskFieldsSchema.shape.notes.default(""),
});
export type DealTaskCreate = z.infer<typeof dealTaskCreateSchema>;

export const dealTaskUpdateSchema = dealTaskFieldsSchema.partial().extend({
  status: dealTaskStatusSchema.optional(),
});
export type DealTaskUpdate = z.infer<typeof dealTaskUpdateSchema>;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const dealStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  position: z.number().int(),
  probability: z.number(),
});
export type DealStage = z.infer<typeof dealStageSchema>;

export const dealPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  stages: z.array(dealStageSchema),
});
export type DealPipeline = z.infer<typeof dealPipelineSchema>;

/** Seed stages copied onto a new pipeline when the caller does not supply any. */
export const defaultDealStages = [
  { name: "新規", color: "#64748b", probability: 10 },
  { name: "連絡済み", color: "#3b82f6", probability: 25 },
  { name: "提案", color: "#8b5cf6", probability: 50 },
  { name: "交渉", color: "#f59e0b", probability: 75 },
  { name: "最終確認", color: "#10b981", probability: 90 },
] as const;

const dealStageWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  color: hexColorSchema.default("#64748b"),
  probability: z.number().int().min(0).max(100).default(0),
});

export const dealPipelineCreateSchema = z.object({
  name: z.string().trim().min(1).max(191),
  isDefault: z.boolean().default(false),
  stages: z
    .array(dealStageWriteSchema)
    .min(1)
    .max(20)
    .default(() => defaultDealStages.map((stage) => ({ ...stage }))),
});
export type DealPipelineCreate = z.infer<typeof dealPipelineCreateSchema>;

export const dealPipelineUpdateSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  isDefault: z.boolean().optional(),
  stages: z
    .array(dealStageWriteSchema.extend({ id: z.string().min(1).optional() }))
    .min(1)
    .max(20)
    .optional(),
});
export type DealPipelineUpdate = z.infer<typeof dealPipelineUpdateSchema>;

const dealContactOptionSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});

const dealCompanyOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
});

const dealMemberOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const dealOptionsSchema = z.object({
  pipelines: z.array(dealPipelineSchema),
  contacts: z.array(dealContactOptionSchema),
  companies: z.array(dealCompanyOptionSchema),
  members: z.array(dealMemberOptionSchema),
});
export type DealOptions = z.infer<typeof dealOptionsSchema>;

export const dealSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  pipelineId: z.string(),
  pipelineName: z.string(),
  stageId: z.string(),
  stageName: z.string(),
  stageColor: z.string(),
  stagePosition: z.number().int(),
  stageProbability: z.number(),
  name: z.string(),
  value: z.number(),
  currency: z.string(),
  status: dealStatusSchema,
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  contactId: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  description: z.string(),
  wonAt: z.string().nullable(),
  lostAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  openTaskCount: z.number().int().nonnegative(),
  nextTaskAt: z.string().nullable(),
});
export type DealSummary = z.infer<typeof dealSummarySchema>;

export const dealTaskSchema = z.object({
  id: z.string(),
  dealId: z.string().nullable(),
  contactId: z.string().nullable().default(null),
  type: dealTaskTypeSchema,
  title: z.string(),
  notes: z.string(),
  dueAt: z.string().nullable(),
  status: dealTaskStatusSchema,
  assignedUserId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  assigneeEmail: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DealTask = z.infer<typeof dealTaskSchema>;

export const dealTaskListItemSchema = dealTaskSchema.extend({
  dealName: z.string(),
});
export type DealTaskListItem = z.infer<typeof dealTaskListItemSchema>;

const dealListSummarySchema = z.object({
  openCount: z.number().int().nonnegative(),
  openValue: z.number(),
  wonCount: z.number().int().nonnegative(),
  wonValue: z.number(),
  lostCount: z.number().int().nonnegative(),
});

export const dealListDataSchema = z.object({
  items: z.array(dealSummarySchema),
  summary: dealListSummarySchema,
});
export type DealListData = z.infer<typeof dealListDataSchema>;

export const dealDetailDataSchema = z.object({
  deal: dealSummarySchema,
  tasks: z.array(dealTaskSchema),
});
export type DealDetailData = z.infer<typeof dealDetailDataSchema>;

/** Same task resource for contact detail, deal detail and workspace task lists. */
export const contactTaskCreateSchema = dealTaskCreateSchema
  .extend({
    contactId: nullableIdSchema,
    dealId: nullableIdSchema,
  })
  .refine((input) => Boolean(input.contactId || input.dealId), "A contact or deal is required");
export type ContactTaskCreate = z.infer<typeof contactTaskCreateSchema>;
export const salesHandoffSchema = z.object({
  contactId: z.string().min(1),
  executionKey: z.string().min(1).max(191),
  ownerUserId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  preserveOwner: z.boolean().default(true),
  title: z.string().trim().min(1).max(191).default("Follow up with qualified lead"),
  dueAt: z.iso.datetime().nullable().optional(),
});
export type SalesHandoff = z.infer<typeof salesHandoffSchema>;
export const assignmentGroupWriteSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(191),
    mode: z.enum(["fixed", "round_robin"]),
    userIds: z.array(z.string().min(1)).min(1, "少なくとも1人の担当者が必要です").max(100),
  })
  .refine(
    (input) => input.mode !== "fixed" || input.userIds.length === 1,
    "Fixed groups require one user",
  );
export type AssignmentGroupWrite = z.infer<typeof assignmentGroupWriteSchema>;
export const assignmentGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(["fixed", "round_robin"]),
  userIds: z.array(z.string()),
});
export const salesHandoffResultSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  ownerUserId: z.string(),
  taskId: z.string(),
  createdAt: z.string(),
});
export const appNotificationSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  title: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
