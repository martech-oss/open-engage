import {
  segmentFilterSchema,
  type SegmentField,
  type SegmentFilter,
  type SegmentGenerationCatalog,
  type SegmentResourceKind,
  type SegmentResourceOption,
  type SegmentValidationIssue,
  type SegmentValidationResult,
} from "@openengage/core/segments";
import { formatIssuePath, type WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { SegmentRepository } from "@openengage/database/segments";

const SYSTEM_EVENTS = [
  "project_member_joined",
  "project_member_progressed",
  "project_member_succeeded",
  "contact_created",
  "form_submitted",
  "page_viewed",
  "email_opened",
  "email_clicked",
  "email_replied",
  "custom_redirect_clicked",
  "segment_joined",
] as const;

export async function loadSegmentCatalog(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SegmentGenerationCatalog> {
  const rows = await new SegmentRepository(database, workspace).loadGenerationCatalogRows();
  const events = new Map<string, SegmentResourceOption>();
  for (const type of SYSTEM_EVENTS) {
    events.set(type, {
      id: `system:${type}`,
      name: type,
      value: type,
      description: "System event",
    });
  }
  for (const row of rows.events) {
    const value =
      (row.type === "custom_event" || row.type === "webhook_event") && row.resourceId
        ? row.resourceId
        : row.type;
    events.set(value, {
      id: `${row.type}:${row.resourceId ?? ""}`,
      name: value,
      value,
      description:
        row.type === "custom_event" || row.type === "webhook_event"
          ? "Observed custom event"
          : "Observed system event",
    });
  }
  return {
    projects: rows.projects.map((row) => ({ id: row.id, name: row.name, value: row.id })),
    projectStatuses: rows.projectStatuses,
    categories: rows.categories.map((row) => ({ id: row.id, name: row.name, value: row.id })),
    companyCustomFields: rows.companyCustomFields.map((row) => ({
      id: row.id,
      name: row.label,
      value: row.key,
      dataType: customFieldDataType(row.dataType),
    })),
    dealStages: rows.dealStages.map((row) => ({ id: row.id, name: row.name, value: row.id })),
    tags: rows.tags.map((row) => ({ id: row.id, name: row.name, value: row.slug })),
    staticSegments: rows.staticSegments.map((row) => ({
      id: row.id,
      name: row.name,
      value: row.slug,
    })),
    companies: rows.companies.map((row) => ({ id: row.id, name: row.name, value: row.name })),
    subscriptionTopics: rows.subscriptionTopics.map((row) => ({
      id: row.id,
      name: row.name,
      value: row.slug,
      ...(row.description ? { description: row.description } : {}),
    })),
    events: [...events.values()].slice(0, 1_000),
    customFields: rows.customFields.map((row) => ({
      id: row.id,
      name: row.label,
      value: row.key,
      dataType: customFieldDataType(row.dataType),
    })),
    stages: rows.stages.map((row) => row.stage),
  };
}

export async function validateSegmentFilter(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  filter: unknown,
  providedCatalog?: SegmentGenerationCatalog,
): Promise<SegmentValidationResult> {
  return validateSegmentFilterWithCatalog(
    filter,
    providedCatalog ?? (await loadSegmentCatalog(database, workspace)),
  );
}

export function validateSegmentFilterWithCatalog(
  filter: unknown,
  catalog: SegmentGenerationCatalog,
): SegmentValidationResult {
  const parsed = segmentFilterSchema.safeParse(filter);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        phase: "schema",
        code: issue.code,
        path: formatIssuePath(issue.path),
        message: issue.message,
      })),
    };
  }
  const issues: SegmentValidationIssue[] = [];
  validateNode(parsed.data, "$", catalog, issues);
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, normalized: parsed.data, issues: [] };
}

function validateNode(
  filter: SegmentFilter,
  path: string,
  catalog: SegmentGenerationCatalog,
  issues: SegmentValidationIssue[],
): void {
  if (filter.kind === "group") {
    filter.children.forEach((child, index) =>
      validateNode(child, `${path}.children[${index}]`, catalog, issues),
    );
    return;
  }
  if (filter.program) {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (
      !values.every((value) =>
        (catalog.projectStatuses ?? []).some(
          (option) =>
            option.programStatus?.projectId === filter.program!.projectId &&
            option.programStatus.definitionVersion === filter.program!.definitionVersion &&
            option.programStatus.statusId === value,
        ),
      )
    )
      issues.push({
        phase: "resource",
        code: "resource_not_found",
        path,
        message: "Program status/version does not exist in this workspace",
      });
  }
  if (filter.field === "project_id" && !["exists", "not_exists"].includes(filter.operator)) {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (
      !values.every((value) => (catalog.projects ?? []).some((project) => project.value === value))
    )
      issues.push({
        phase: "resource",
        code: "resource_not_found",
        path,
        message: "Project does not exist in this workspace",
      });
  }
  const richOptions =
    filter.field === "category_score"
      ? catalog.categories
      : filter.field === "company_custom_field"
        ? catalog.companyCustomFields
        : filter.field === "deal_stage_id"
          ? catalog.dealStages
          : undefined;
  if (
    richOptions &&
    !(filter.field === "deal_stage_id" && ["exists", "not_exists"].includes(filter.operator))
  ) {
    const value = filter.field === "deal_stage_id" ? filter.value : filter.key;
    const values = Array.isArray(value) ? value : [value];
    if (!values.every((item) => richOptions.some((option) => option.value === item)))
      issues.push({
        phase: "resource",
        code: "resource_not_found",
        path,
        message: `${filter.field} resource does not exist in this workspace`,
      });
  }
  const resource = resourceForField(filter.field);
  if (resource) {
    const value =
      filter.field === "event" || filter.field === "custom_field" ? filter.key : filter.value;
    if (
      typeof value !== "string" ||
      !optionsForKind(catalog, resource).some((item) => item.value === value)
    ) {
      issues.push({
        phase: "resource",
        code: "resource_not_found",
        path: `${path}.${filter.field === "event" || filter.field === "custom_field" ? "key" : "value"}`,
        message: `${filter.field} resource does not exist in this workspace`,
      });
      return;
    }
  }
  if ((filter.field !== "custom_field" && filter.field !== "company_custom_field") || !filter.key)
    return;
  const definition = (
    filter.field === "company_custom_field"
      ? (catalog.companyCustomFields ?? [])
      : catalog.customFields
  ).find((item) => item.value === filter.key);
  if (!definition?.dataType) return;
  if (!["exists", "not_exists"].includes(filter.operator)) {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const valid = values.every((value) =>
      definition.dataType === "number"
        ? typeof value === "number"
        : definition.dataType === "boolean"
          ? typeof value === "boolean"
          : typeof value === "string" &&
            (definition.dataType !== "date" || Number.isFinite(Date.parse(value))),
    );
    if (!valid)
      issues.push({
        phase: "resource",
        code: "operator_type_mismatch",
        path: `${path}.value`,
        message: `Value must match the ${definition.dataType} custom field type`,
      });
  }
  const allowed = customFieldOperators(definition.dataType);
  if (!allowed.has(filter.operator)) {
    issues.push({
      phase: "resource",
      code: "operator_type_mismatch",
      path: `${path}.operator`,
      message: `${filter.operator} is not supported for ${definition.dataType} custom fields`,
    });
  }
}

export function optionsForKind(
  catalog: SegmentGenerationCatalog,
  kind: SegmentResourceKind,
): SegmentResourceOption[] {
  switch (kind) {
    case "tag":
      return catalog.tags;
    case "static_segment":
      return catalog.staticSegments;
    case "company":
      return catalog.companies;
    case "subscription_topic":
      return catalog.subscriptionTopics;
    case "event":
      return catalog.events;
    case "custom_field":
      return catalog.customFields;
  }
}

function resourceForField(field: SegmentField): SegmentResourceKind | null {
  switch (field) {
    case "tag":
      return "tag";
    case "segment":
      return "static_segment";
    case "company":
      return "company";
    case "subscription":
      return "subscription_topic";
    case "event":
      return "event";
    case "custom_field":
      return "custom_field";
    default:
      return null;
  }
}

function customFieldOperators(dataType: string): ReadonlySet<string> {
  const unary = ["eq", "neq", "exists", "not_exists"];
  switch (dataType) {
    case "number":
    case "date":
      return new Set([...unary, "in", "gt", "gte", "lt", "lte"]);
    case "text":
      return new Set([...unary, "in", "contains", "starts_with"]);
    case "select":
      return new Set([...unary, "in"]);
    case "boolean":
      return new Set(unary);
    default:
      return new Set();
  }
}

function customFieldDataType(value: string): "text" | "number" | "boolean" | "date" | "select" {
  return value === "number" || value === "boolean" || value === "date" || value === "select"
    ? value
    : "text";
}
