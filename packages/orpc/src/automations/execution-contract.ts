import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  automationRunSchema,
  automationRunDetailSchema,
  automationEnrollmentDetailSchema,
} from "@openengage/core/automations";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";
const notFound = {
  AUTOMATION_EXECUTION_NOT_FOUND: { status: 404, message: "実行履歴が見つかりません" },
} as const;
const commandErrors = {
  ...authedErrors,
  ...notFound,
  INVALID_AUTOMATION_RUN: { status: 422, message: "バッチを開始できません" },
} as const;
const runInput = z.object({ id: z.string().min(1), runId: z.string().min(1) });
const enrollmentInput = z.object({ id: z.string().min(1), enrollmentId: z.string().min(1) });
export const automationExecutionContract = {
  listEnrollments: oc
    .route({ method: "GET", path: "/automations/{id}/enrollments" })
    .errors(workspaceErrors)
    .input(idInput)
    .output(
      z.array(
        z.object({
          id: z.string(),
          automationId: z.string(),
          contactId: z.string(),
          status: z.string(),
          enteredAt: z.string(),
          completedAt: z.string().nullable(),
          parentJobId: z.string().nullable(),
          lastError: z.string().nullable(),
        }),
      ),
    ),
  executionOptions: oc
    .route({ method: "GET", path: "/automations/execution-options" })
    .errors(workspaceErrors)
    .output(
      z.object({
        projects: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            statuses: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
        ),
        callableAutomations: z.array(z.object({ id: z.string(), name: z.string() })),
        scoringCategories: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),
  previewRun: oc
    .route({ method: "POST", path: "/automations/{id}/runs/preview" })
    .errors(commandErrors)
    .input(idInput)
    .output(
      z.object({
        versionId: z.string(),
        count: z.number(),
        sample: z.array(z.object({ id: z.string(), email: z.string().nullable() })),
      }),
    ),
  startRun: oc
    .route({ method: "POST", path: "/automations/{id}/runs", successStatus: 202 })
    .errors(commandErrors)
    .input(
      z.object({
        id: z.string().min(1),
        requestId: z.string().min(1).max(191),
        versionId: z.string().min(1),
      }),
    )
    .output(automationRunSchema),
  listRuns: oc
    .route({ method: "GET", path: "/automations/{id}/runs" })
    .errors(workspaceErrors)
    .input(idInput)
    .output(z.array(automationRunSchema)),
  runDetail: oc
    .route({ method: "GET", path: "/automations/{id}/runs/{runId}" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(runInput.extend({ cursor: z.string().optional() }))
    .output(automationRunDetailSchema),
  cancelRun: oc
    .route({ method: "POST", path: "/automations/{id}/runs/{runId}/cancel" })
    .errors(commandErrors)
    .input(runInput)
    .output(ackSchema),
  enrollmentDetail: oc
    .route({ method: "GET", path: "/automations/{id}/enrollments/{enrollmentId}" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(enrollmentInput)
    .output(automationEnrollmentDetailSchema),
  cancelEnrollment: oc
    .route({ method: "POST", path: "/automations/{id}/enrollments/{enrollmentId}/cancel" })
    .errors(commandErrors)
    .input(enrollmentInput)
    .output(ackSchema),
};
