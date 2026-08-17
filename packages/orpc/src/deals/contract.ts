import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  dealCreateSchema,
  dealDetailDataSchema,
  dealListDataSchema,
  dealOptionsSchema,
  dealSummarySchema,
  dealTaskCreateSchema,
  dealTaskListItemSchema,
  dealTaskSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
} from "@openengage/core/deals";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";

const dealNotFound = { DEAL_NOT_FOUND: { status: 404, message: "商談が見つかりません" } } as const;
const taskNotFound = {
  DEAL_TASK_NOT_FOUND: { status: 404, message: "タスクが見つかりません" },
} as const;
// The route reports a specific reason per bad reference, so the message is
// supplied at throw time rather than fixed here.
const badReference = {
  INVALID_DEAL_REFERENCE: { status: 422, message: "参照先が見つかりません" },
} as const;
const badStage = {
  INVALID_DEAL_STAGE: { status: 422, message: "移動先ステージがパイプラインに存在しません" },
} as const;
const base = authedErrors;

export const dealsContract = {
  options: oc
    .route({ method: "GET", path: "/deals/options" })
    .errors(workspaceErrors)
    .output(dealOptionsSchema),
  list: oc
    .route({ method: "GET", path: "/deals" })
    .errors({
      ...workspaceErrors,
      DEAL_PIPELINE_NOT_FOUND: { status: 404, message: "パイプラインが見つかりません" },
    })
    .input(
      z.object({
        pipelineId: z.string().min(1).optional(),
        status: z.enum(["open", "won", "lost", "all"]).default("open"),
        q: z.string().trim().max(191).optional(),
      }),
    )
    .output(dealListDataSchema),
  listTasks: oc
    .route({ method: "GET", path: "/deals/tasks" })
    .errors(workspaceErrors)
    .input(
      z.object({
        status: z.enum(["open", "completed", "all"]).default("open"),
      }),
    )
    .output(z.array(dealTaskListItemSchema)),
  get: oc
    .route({ method: "GET", path: "/deals/{id}" })
    .errors({ ...workspaceErrors, ...dealNotFound })
    .input(z.object({ id: z.string().min(1) }))
    .output(dealDetailDataSchema),
  create: oc
    .route({ method: "POST", path: "/deals", successStatus: 201 })
    .errors({ ...base, ...badReference })
    .input(dealCreateSchema)
    .output(dealSummarySchema),
  update: oc
    .route({ method: "PATCH", path: "/deals/{id}" })
    .errors({ ...base, ...dealNotFound, ...badReference })
    .input(dealUpdateSchema.extend({ id: z.string().min(1) }))
    .output(dealSummarySchema),
  move: oc
    .route({ method: "POST", path: "/deals/{id}/move" })
    .errors({ ...base, ...dealNotFound, ...badStage })
    .input(z.object({ id: z.string().min(1), stageId: z.string().min(1) }))
    .output(dealSummarySchema),
  archive: oc
    .route({ method: "POST", path: "/deals/{id}/archive" })
    .errors({ ...base, ...dealNotFound })
    .input(z.object({ id: z.string().min(1) }))
    .output(ackSchema),
  createTask: oc
    .route({ method: "POST", path: "/deals/{dealId}/tasks", successStatus: 201 })
    .errors({
      ...base,
      ...dealNotFound,
      INVALID_DEAL_TASK_ASSIGNEE: { status: 422, message: "担当者が見つかりません" },
    })
    .input(dealTaskCreateSchema.extend({ dealId: z.string().min(1) }))
    .output(dealTaskSchema),
  updateTask: oc
    .route({ method: "PATCH", path: "/deals/{dealId}/tasks/{taskId}" })
    .errors({
      ...base,
      ...taskNotFound,
      INVALID_DEAL_TASK_ASSIGNEE: { status: 422, message: "担当者が見つかりません" },
    })
    .input(
      dealTaskUpdateSchema.extend({
        dealId: z.string().min(1),
        taskId: z.string().min(1),
      }),
    )
    .output(dealTaskSchema),
  deleteTask: oc
    .route({ method: "DELETE", path: "/deals/{dealId}/tasks/{taskId}" })
    .errors({ ...base, ...taskNotFound })
    .input(z.object({ dealId: z.string().min(1), taskId: z.string().min(1) }))
    .output(ackSchema),
};
