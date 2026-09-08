import {
  rewriteProjectCloneReferences,
  type ProjectCloneOptions,
  type ProjectCloneReferenceMap,
  type ProjectCloneResource,
} from "@openengage/core/projects";

import { projectCloneTransforms } from "./clone-transforms";

const jsonColumns = new Set([
  "definition",
  "sourceDefinition",
  "document",
  "contentDocument",
  "formBindings",
  "graph",
  "filterAst",
  "variants",
  "rules",
  "draftContent",
  "programBinding",
]);

export function prepareProjectCloneRow(
  resource: ProjectCloneResource,
  source: Record<string, unknown>,
  map: ProjectCloneReferenceMap,
  options: ProjectCloneOptions,
  now: string,
): Record<string, unknown> {
  const decoded = Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      if (typeof value === "string" && jsonColumns.has(key)) {
        try {
          return [key, JSON.parse(value) as unknown];
        } catch {
          return [key, value];
        }
      }
      return [key, value];
    }),
  );
  const rewritten = rewriteProjectCloneReferences(decoded, map) as Record<string, unknown>;
  const row = Object.fromEntries(
    Object.entries(rewritten).map(([key, value]) => [
      key,
      jsonColumns.has(key) && typeof value !== "string" && value !== null
        ? JSON.stringify(value)
        : value,
    ]),
  );
  if ("id" in row) row.id = resource.targetId;
  if ("createdAt" in row) row.createdAt = now;
  if ("updatedAt" in row) row.updatedAt = now;
  if ("archivedAt" in row) row.archivedAt = null;
  if (resource.targetSlug) row.slug = resource.targetSlug;
  // Version pointers are structural references too, but all public pointers are deliberately cleared.
  for (const key of [
    "draftVersionId",
    "currentVersionId",
    "programDefinitionId",
    "draftProgramDefinitionId",
  ]) {
    if (typeof row[key] === "string") row[key] = map.ids[row[key]] ?? row[key];
  }
  if ("publishedVersionId" in row) row.publishedVersionId = null;
  if ("publishedAt" in row) row.publishedAt = null;
  if ("publishedDocument" in row) row.publishedDocument = null;
  if ("variableSnapshot" in row) row.variableSnapshot = null;
  if ("resolvedVariables" in row) row.resolvedVariables = null;
  if ("resolvedGraph" in row) row.resolvedGraph = null;
  projectCloneTransforms[resource.kind](row, source, map, options);
  return row;
}
