import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  variableDefinitionSchema,
  variableImpactInputSchema,
  variableImpactSchema,
  variableKeySchema,
  variableSnapshotSchema,
  variableUsageSchema,
  variableWriteSchema,
} from "@openengage/core/projects";

import { authedErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";
const scope = z.object({ projectId: z.string().min(1).nullable().default(null) });
const errors = {
  ...authedErrors,
  VARIABLE_INVALID: { status: 422, message: "変数の型、値、参照を確認してください" },
  VARIABLE_CONFLICT: { status: 409, message: "変数が更新されています。再読み込みしてください" },
  PROJECT_NOT_FOUND: { status: 404, message: "Projectが見つかりません" },
};
export const variablesContract = {
  variablesList: oc
    .route({ method: "GET", path: "/projects/variables" })
    .errors(errors)
    .input(scope)
    .output(
      z.object({
        definitions: z.array(variableDefinitionSchema),
        effective: variableSnapshotSchema,
        canEdit: z.boolean(),
      }),
    ),
  variablesSave: oc
    .route({ method: "PUT", path: "/projects/variables/{key}" })
    .errors(errors)
    .input(variableWriteSchema)
    .output(variableDefinitionSchema),
  variablesDelete: oc
    .route({ method: "DELETE", path: "/projects/variables/{key}" })
    .errors(errors)
    .input(scope.extend({ key: variableKeySchema, expectedRevision: z.number().int().positive() }))
    .output(ackSchema),
  variablesUses: oc
    .route({ method: "GET", path: "/projects/variables/uses" })
    .errors(errors)
    .input(scope.extend({ key: variableKeySchema.optional() }))
    .output(z.array(variableUsageSchema)),
  variablesImpact: oc
    .route({ method: "POST", path: "/projects/variables/impact" })
    .errors(errors)
    .input(variableImpactInputSchema)
    .output(z.array(variableImpactSchema)),
};
