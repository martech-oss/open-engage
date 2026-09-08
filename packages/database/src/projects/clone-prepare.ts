import {
  rewriteProjectCloneReferences,
  type ProjectCloneOptions,
  type ProjectCloneReferenceMap,
  type ProjectCloneResource,
} from "@openengage/core/projects";

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
  switch (resource.kind) {
    case "project":
      row.name = options.name;
      break;
    case "brief":
      Object.assign(row, {
        status: "draft",
        revision: 1,
        rowVersion: 1,
        ownerUserId: options.ownerUserId,
        approverUserId: options.approverUserId,
        reviewAt: options.reviewAt,
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        completedAt: null,
      });
      break;
    case "automation":
      row.status = "draft";
      break;
    case "automation_version":
      Object.assign(row, { status: "draft", version: 1 });
      if ("dependencies" in row) row.dependencies = "{}";
      if ("pinnedDependencies" in row) row.pinnedDependencies = "{}";
      break;
    case "form":
    case "landing_page":
      row.status = "draft";
      break;
    case "experiment":
      Object.assign(row, {
        status: "draft",
        winnerVariantId: null,
        startedAt: null,
        endedAt: null,
      });
      break;
    case "segment":
      Object.assign(row, {
        memberCount: 0,
        evaluatedAt: null,
        evaluationStatus: row.kind === "dynamic" ? "pending" : "ready",
        evaluationError: null,
        filterVersion: 1,
      });
      break;
    case "redirect":
      Object.assign(row, { clickCount: 0, status: "draft" });
      break;
    case "email_sequence":
      Object.assign(row, {
        draftRevision: 1,
        publishedSubject: null,
        publishedContent: null,
        publishedRevision: null,
        publishedAt: null,
      });
      break;
    case "variable": {
      row.revision = 1;
      row.deletedAt = null;
      const key = String(row.key);
      if (Object.prototype.hasOwnProperty.call(options.variables, key))
        row.value = JSON.stringify(options.variables[key]);
      break;
    }
    case "program":
      Object.assign(row, { rowVersion: 1, publishedVersion: null });
      break;
    case "form_version":
      row.programBinding = null;
      break;
    case "form_binding":
      if (map.ids[String(source.projectId)]) row.definitionVersion = null;
      break;
    case "landing_page_version":
    case "dynamic_content":
      break;
  }
  return row;
}
