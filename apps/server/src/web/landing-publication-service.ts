import type { ProgramBinding } from "@openengage/core/projects";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { FormProgramRepository } from "@openengage/database/projects";
import { LandingDesignRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { validateLandingReferences } from "./landing-reference-validation";
import { resolveLandingVariablePublication } from "./variable-publication-service";

export async function publishLandingPage(
  database: OpenEngageDatabase,
  workspaceId: string,
  env: RuntimeEnv,
  input: { id: string; versionId: string; baseVersionId: string },
) {
  const repository = new LandingDesignRepository(database, { workspaceId });
  const page = await repository.page(input.id),
    version = await repository.version(input.id, input.versionId);
  if (!page || !version) return "not_found" as const;
  if (page.currentVersionId !== input.baseVersionId) return "conflict" as const;
  const { snapshot, formSnapshots, document } =
    version.publishedDocument && version.variableSnapshot
      ? {
          snapshot: version.variableSnapshot,
          formSnapshots: {},
          document: version.publishedDocument,
        }
      : await resolveLandingVariablePublication(database, workspaceId, version.document);
  await validateLandingReferences(database, workspaceId, document, env, true);
  const programBindings: Record<string, ProgramBinding | null> = {};
  if (!version.publishedAt) {
    const programs = new FormProgramRepository(database, { workspaceId });
    for (const form of version.document.forms) {
      const binding = form.formId ? await programs.get(form.formId) : null;
      programBindings[form.refId] = binding
        ? await programs.validate(binding, document.measurement.projectId)
        : null;
    }
  }
  await repository.publish(input.id, input.versionId, input.baseVersionId, {
    document,
    snapshot,
    formSnapshots,
    programBindings,
  });
  return "ok" as const;
}
