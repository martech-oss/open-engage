import { oc } from "@orpc/contract";
import * as z from "zod";

import { reportDateRangeSchema } from "@openengage/core/reports";
import {
  dynamicContentSchema,
  dynamicContentWriteSchema,
  experimentReportSchema,
  experimentSchema,
  experimentWriteSchema,
} from "@openengage/core/web";

import { authedErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";
const errors = {
  ...authedErrors,
  OPTIMIZATION_NOT_FOUND: { status: 404, message: "ページまたはテストが見つかりません" },
  OPTIMIZATION_CONFLICT: { status: 409, message: "公開版またはテストの状態が更新されています" },
  OPTIMIZATION_INVALID: {
    status: 422,
    message: "公開版・配分・セグメント・表示箇所を確認してください",
  },
} as const;
export const optimizationContract = {
  listExperiments: oc
    .route({ method: "GET", path: "/website/pages/{pageId}/experiments" })
    .errors(errors)
    .input(z.object({ pageId: z.string() }))
    .output(z.array(experimentSchema)),
  createExperiment: oc
    .route({ method: "POST", path: "/website/pages/{pageId}/experiments", successStatus: 201 })
    .errors(errors)
    .input(experimentWriteSchema)
    .output(ackSchema),
  startExperiment: oc
    .route({ method: "POST", path: "/website/experiments/{id}/start" })
    .errors(errors)
    .input(idInput)
    .output(ackSchema),
  endExperiment: oc
    .route({ method: "POST", path: "/website/experiments/{id}/end" })
    .errors(errors)
    .input(
      idInput.extend({
        winnerVariantId: z.string().nullable(),
        expectedPublishedVersionId: z.string(),
      }),
    )
    .output(ackSchema),
  experimentReport: oc
    .route({ method: "GET", path: "/website/experiments/{id}/report" })
    .errors(errors)
    .input(reportDateRangeSchema.safeExtend({ id: z.string() }))
    .output(experimentReportSchema),
  listDynamicContent: oc
    .route({ method: "GET", path: "/website/pages/{pageId}/dynamic-content" })
    .errors(errors)
    .input(z.object({ pageId: z.string() }))
    .output(z.array(dynamicContentSchema)),
  saveDynamicContent: oc
    .route({ method: "PUT", path: "/website/pages/{pageId}/dynamic-content/{slotId}" })
    .errors(errors)
    .input(dynamicContentWriteSchema)
    .output(ackSchema),
};
