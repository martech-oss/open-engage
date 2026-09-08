import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  programMemberImportSchema,
  programBindingSchema,
  programCohortInputSchema,
  programCohortSchema,
  programMemberMutationSchema,
  programMemberMutationResultSchema,
  projectMemberTransitionSchema,
  projectMemberListSchema,
  projectProgramDefinitionSchema,
  projectProgramDetailSchema,
  projectProgramSchema,
  projectProgramCatalogSchema,
} from "@openengage/core/projects";

import { authedErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";
const errors = {
  ...authedErrors,
  PROGRAM_NOT_FOUND: { status: 404, message: "Project、参加者、または公開定義が見つかりません" },
  PROGRAM_CONFLICT: {
    status: 409,
    message: "他の更新と競合しています。最新状態を確認してください",
  },
  PROGRAM_INVALID: { status: 422, message: "施策の定義・進捗・フォーム紐付けを確認してください" },
};
const base = oc.errors(errors);
export const programContract = {
  programCatalog: base
    .route({ method: "GET", path: "/projects/catalog" })
    .output(projectProgramCatalogSchema),
  programGet: base
    .route({ method: "GET", path: "/projects/{id}/program" })
    .input(idInput)
    .output(projectProgramDetailSchema),
  programSave: base
    .route({ method: "PUT", path: "/projects/{id}/program" })
    .input(
      idInput.extend({
        definition: projectProgramDefinitionSchema,
        expectedRowVersion: z.number().int().nonnegative(),
      }),
    )
    .output(projectProgramSchema),
  programPublish: base
    .route({ method: "POST", path: "/projects/{id}/program/publish" })
    .input(
      idInput.extend({
        expectedRowVersion: z.number().int().positive(),
        confirmed: z.literal(true),
      }),
    )
    .output(projectProgramSchema),
  memberList: base
    .route({ method: "GET", path: "/projects/{id}/members" })
    .input(
      idInput.extend({
        query: z.string().max(191).optional(),
        statusId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
    )
    .output(projectMemberListSchema),
  memberMutate: base
    .route({ method: "POST", path: "/projects/{id}/members" })
    .input(programMemberMutationSchema.omit({ projectId: true }).extend(idInput.shape))
    .output(programMemberMutationResultSchema),
  memberImport: base
    .route({ method: "POST", path: "/projects/{id}/members/import" })
    .input(
      idInput.extend({
        csv: z.string().min(1).max(1000000),
        idempotencyKey: z.string().min(8).max(150),
      }),
    )
    .output(programMemberImportSchema),
  memberImportGet: base
    .route({ method: "GET", path: "/projects/{id}/members/import/{jobId}" })
    .input(idInput.extend({ jobId: z.string().min(1) }))
    .output(programMemberImportSchema),
  memberHistory: base
    .route({ method: "GET", path: "/projects/{id}/members/{contactId}/history" })
    .input(idInput.extend({ contactId: z.string().min(1) }))
    .output(z.array(projectMemberTransitionSchema)),
  programCohort: base
    .route({ method: "GET", path: "/projects/{id}/program/cohort" })
    .input(programCohortInputSchema.extend(idInput.shape))
    .output(programCohortSchema),
  programBindForm: base
    .route({ method: "PUT", path: "/projects/{id}/program/forms/{formId}" })
    .input(
      idInput.extend({
        formId: z.string().min(1),
        binding: programBindingSchema.nullable(),
        confirmed: z.literal(true),
      }),
    )
    .output(ackSchema),
};
