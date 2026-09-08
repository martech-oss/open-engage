import {
  createVariableSnapshot,
  resolveVariableRef,
  type VariableImpactInput,
  type VariableUsage,
} from "@openengage/core/projects";
import {
  createDatabase,
  type DatabaseSource,
  type OpenEngageDatabase,
} from "@openengage/database/client";
import { VariableRepository, VariableUsageRepository } from "@openengage/database/projects";

/** Publication only. Runtime consumers retain this snapshot with their immutable version. */
export async function resolveProjectVariables(
  database: OpenEngageDatabase,
  workspaceId: string,
  projectId: string | null,
) {
  return new VariableRepository(database, { workspaceId }).resolve(projectId);
}
export async function listVariableUses(
  database: DatabaseSource,
  workspaceId: string,
  input: { projectId: string | null; key?: string | undefined },
): Promise<VariableUsage[]> {
  await new VariableRepository(database, { workspaceId }).assertProject(input.projectId);
  return (await new VariableUsageRepository(database, { workspaceId }).list()).filter(
    (usage) =>
      (input.projectId === null || usage.projectId === input.projectId) &&
      (!input.key || usage.references.some((ref) => ref.key === input.key)),
  );
}
export async function previewVariableImpact(
  source: DatabaseSource,
  workspaceId: string,
  input: VariableImpactInput,
) {
  const database = createDatabase(source),
    repository = new VariableRepository(database, { workspaceId });
  const uses = await listVariableUses(database, workspaceId, input);
  const scopes = new Map<string | null, Awaited<ReturnType<typeof repository.list>>>();
  for (const usage of uses)
    if (!scopes.has(usage.projectId))
      scopes.set(usage.projectId, await repository.list(usage.projectId));
  return uses.map((usage) => {
    const definitions = scopes.get(usage.projectId)!;
    const current = createVariableSnapshot(definitions, workspaceId, usage.projectId);
    const ref = usage.references.find((ref) => ref.key === input.key)!;
    const before =
      (usage.snapshot ?? current).values.find((value) => value.key === input.key)?.value ?? null;
    const updated = definitions.filter(
      (value) => !(value.projectId === input.projectId && value.key === input.key),
    );
    if (!input.remove)
      updated.push({
        id: "preview",
        workspaceId,
        projectId: input.projectId,
        key: input.key,
        type: input.type,
        value: input.value,
        revision: input.expectedRevision + 1,
        updatedAt: "",
      });
    let after: string | number | boolean | null = null,
      error: string | null = null;
    try {
      after = resolveVariableRef(
        ref,
        createVariableSnapshot(updated, workspaceId, usage.projectId),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Variable resolution failed";
    }
    return {
      ...usage,
      before,
      after,
      error,
      requiresRepublish: usage.published && (before !== after || error !== null),
    };
  });
}
