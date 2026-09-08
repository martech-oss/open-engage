import type { OpenEngageDatabase } from "@openengage/database/client";
import { PublicFormRepository, type PublicFormRecord } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { verifyMeasurementContext } from "../web/measurement-service";

/** Token-backed LP forms use the pinned snapshot before mutable status/settings. */
export async function resolvePublicForm(
  database: OpenEngageDatabase,
  env: RuntimeEnv,
  input: {
    workspaceSlug: string;
    formSlug: string;
    measurementToken?: unknown;
    resolvedForm?: PublicFormRecord;
  },
) {
  const repository = new PublicFormRepository(database);
  const reference =
    input.resolvedForm ?? (await repository.findFormReference(input.workspaceSlug, input.formSlug));
  if (!reference) return { kind: "form_not_found" } as const;
  if (input.measurementToken) {
    const measurement = await verifyMeasurementContext(database, env, input.measurementToken, {
      workspaceId: reference.workspaceId,
      formId: reference.id,
    });
    if (!measurement?.form) return { kind: "invalid_context" } as const;
    return { kind: "resolved", form: measurement.form, measurement } as const;
  }
  const form =
    input.resolvedForm ?? (await repository.findPublishedForm(input.workspaceSlug, input.formSlug));
  return form
    ? ({ kind: "resolved", form, measurement: null } as const)
    : ({ kind: "form_not_found" } as const);
}
