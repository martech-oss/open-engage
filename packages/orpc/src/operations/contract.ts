import { oc } from "@orpc/contract";
import * as z from "zod";

import { contactDataJobSchema, contactExportFilterSchema } from "@openengage/core/contacts";
import { deadLetterRowSchema } from "@openengage/core/platform";
import { dashboardSchema } from "@openengage/core/reports";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";

export const CSV_MAX_BYTES = 25 * 1024 * 1024;

export const dashboardContract = {
  get: oc
    .route({ method: "GET", path: "/dashboard" })
    .errors(workspaceErrors)
    .output(dashboardSchema),
};

export const contactDataContract = {
  startImport: oc
    .route({ method: "POST", path: "/contacts/imports", successStatus: 202 })
    .errors({
      ...authedErrors,
      CSV_TOO_LARGE: { status: 422, message: "CSVは25MB以下にしてください" },
      CSV_IDENTIFIER_MISSING: {
        status: 422,
        message: "CSVにはemailまたはexternal_id列が必要です",
      },
    })
    .input(z.object({ file: z.file().max(CSV_MAX_BYTES) }))
    .output(
      z.object({
        jobId: z.string(),
        rows: z.number().int().nonnegative(),
        parts: z.number().int().nonnegative(),
      }),
    ),
  startExport: oc
    .route({ method: "POST", path: "/contacts/exports", successStatus: 202 })
    .errors(authedErrors)
    .input(z.object({ filter: contactExportFilterSchema.optional() }).optional())
    .output(z.object({ jobId: z.string() })),
  getDataJob: oc
    .route({ method: "GET", path: "/contacts/data-jobs/{id}" })
    .errors({
      ...authedErrors,
      DATA_JOB_NOT_FOUND: { status: 404, message: "データJobが見つかりません" },
    })
    .input(idInput)
    .output(contactDataJobSchema),
  downloadExport: oc
    .route({ method: "GET", path: "/contacts/exports/{id}/download" })
    .errors({
      ...authedErrors,
      EXPORT_NOT_READY: { status: 404, message: "Exportはまだ完了していません" },
      EXPORT_MISSING: { status: 404, message: "Exportファイルがありません" },
    })
    .input(idInput)
    .output(z.file()),
};

export const platformContract = {
  listDeadLetters: oc
    .route({ method: "GET", path: "/platform/dead-letters" })
    .errors(authedErrors)
    .output(z.array(deadLetterRowSchema)),
  replayDeadLetter: oc
    .route({ method: "POST", path: "/platform/dead-letters/{id}/replay" })
    .errors({
      ...authedErrors,
      DEAD_LETTER_NOT_FOUND: { status: 404, message: "DLQ項目が見つかりません" },
    })
    .input(idInput)
    .output(ackSchema),
};
