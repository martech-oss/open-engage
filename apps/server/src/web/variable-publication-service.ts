import type { VariableSnapshot } from "@openengage/core/projects";
import { resolveLandingVariables, type LandingPageDocument } from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { SignupFormRepository } from "@openengage/database/web";

import { resolveProjectVariables } from "../projects/variable-service";
import { sanitizeLandingDocument } from "./landing-safety";

export async function resolveLandingVariablePublication(
  database: OpenEngageDatabase,
  workspaceId: string,
  source: LandingPageDocument,
) {
  const snapshot = await resolveProjectVariables(
    database,
    workspaceId,
    source.variableProjectId ?? null,
  );
  const formSnapshots: Record<string, VariableSnapshot> = {};
  const forms = new SignupFormRepository(database, { workspaceId });
  for (const form of source.forms) {
    if (!form.formId) {
      formSnapshots[form.refId] = snapshot;
      continue;
    }
    const context = await forms.variableContext(form.formId);
    if (!context) throw new Error("参照フォームが見つかりません");
    formSnapshots[form.refId] = await resolveProjectVariables(
      database,
      workspaceId,
      context.projectId,
    );
  }
  return {
    snapshot,
    formSnapshots,
    document: await sanitizeLandingDocument(
      resolveLandingVariables(source, snapshot, formSnapshots),
    ),
  };
}
