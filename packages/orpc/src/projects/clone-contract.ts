import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  projectCloneJobSchema,
  projectCloneOptionsSchema,
  projectCloneSummarySchema,
  projectCloneListInputSchema,
  projectClonePageSchema,
} from "@openengage/core/projects";

import { authedErrors } from "../shared/errors";
import { idInput } from "../shared/schemas";

const errors = {
  ...authedErrors,
  PROJECT_CLONE_NOT_FOUND: { status: 404, message: "施策または複製ジョブが見つかりません" },
  PROJECT_CLONE_INVALID: { status: 422, message: "複製内容または参照先が不正です" },
  PROJECT_CLONE_CONFLICT: { status: 409, message: "複製要求が競合しました" },
};
const jobInput = idInput.extend({ jobId: z.string().min(1) });
export const projectCloneContract = {
  clonePreview: oc
    .route({ method: "POST", path: "/projects/{id}/clone-preview" })
    .errors(errors)
    .input(idInput.extend({ options: projectCloneOptionsSchema }))
    .output(projectCloneJobSchema),
  cloneStart: oc
    .route({ method: "POST", path: "/projects/{id}/clones" })
    .errors(errors)
    .input(jobInput.extend({ requestKey: z.string().min(1).max(191) }))
    .output(projectCloneJobSchema),
  cloneList: oc
    .route({ method: "GET", path: "/projects/{id}/clones" })
    .errors(errors)
    .input(idInput.extend(projectCloneListInputSchema.shape))
    .output(projectClonePageSchema),
  cloneProgress: oc
    .route({ method: "GET", path: "/projects/{id}/clones/{jobId}/progress" })
    .errors(errors)
    .input(jobInput)
    .output(projectCloneSummarySchema),
  cloneGet: oc
    .route({ method: "GET", path: "/projects/{id}/clones/{jobId}" })
    .errors(errors)
    .input(jobInput)
    .output(projectCloneJobSchema),
  cloneRetry: oc
    .route({ method: "POST", path: "/projects/{id}/clones/{jobId}/retry" })
    .errors(errors)
    .input(jobInput)
    .output(projectCloneJobSchema),
};
