import type { Contact } from "@openengage/core/contacts";
import { compileSegmentFilter } from "@openengage/core/segments";
import type { SegmentFilter, SegmentRow } from "@openengage/core/segments";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  SegmentRepository,
  type OpenEngageDatabase,
  type SegmentRecord,
} from "@openengage/database";

import {
  nullablePrimitiveString,
  toFiniteNumber,
  parseJsonRecord,
  primitiveString,
} from "../platform/values";

export async function listSegments(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  kind?: "static" | "dynamic",
): Promise<SegmentRow[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments(kind);
  return rows.map(toSegmentRow);
}

export function toSegmentRow(row: SegmentRecord): SegmentRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    kind: row.kind === "dynamic" ? "dynamic" : "static",
    filterAst: row.filterAst,
    membershipSource: row.membershipSource,
    filterVersion: row.filterVersion,
    memberCount: row.memberCount,
    evaluatedAt: row.evaluatedAt,
    evaluationStatus: normalizeEvaluationStatus(row.evaluationStatus),
    evaluationError: row.evaluationError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const PREVIEW_LIMIT = 100;

export async function previewSegment(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  filter: SegmentFilter,
): Promise<{
  contacts: Contact[];
  capped: boolean;
  matchedCount: number;
  normalizedFilter: SegmentFilter;
  warnings: string[];
}> {
  const compiled = compileSegmentFilter(workspace.workspaceId, filter);
  const repository = new SegmentRepository(database, workspace);
  const [rows, matchedCount] = await Promise.all([
    repository.previewContacts(compiled, PREVIEW_LIMIT),
    repository.previewCount(compiled),
  ]);
  return {
    contacts: rows.map(toPreviewContact),
    capped: matchedCount > rows.length,
    matchedCount,
    normalizedFilter: filter,
    warnings: [],
  };
}

function normalizeEvaluationStatus(value: string): "pending" | "running" | "ready" | "failed" {
  return value === "pending" || value === "running" || value === "failed" ? value : "ready";
}

export function toPreviewContact(row: Record<string, unknown>): Contact {
  const rawStatus = primitiveString(row["status"]);
  const status =
    rawStatus === "archived" || rawStatus === "anonymous" ? rawStatus : ("active" as const);
  return {
    id: primitiveString(row["id"]),
    workspaceId: primitiveString(row["workspace_id"]),
    visitorId: nullablePrimitiveString(row["visitor_id"]),
    email: nullablePrimitiveString(row["email"]),
    firstName: nullablePrimitiveString(row["first_name"]),
    lastName: nullablePrimitiveString(row["last_name"]),
    phone: nullablePrimitiveString(row["phone"]),
    externalId: nullablePrimitiveString(row["external_id"]),
    stage: primitiveString(row["stage"]),
    score: toFiniteNumber(row["score"]),
    gradePoints: toFiniteNumber(row["grade_points"]),
    status,
    archivedAt: nullablePrimitiveString(row["archived_at"]),
    customFields: parseJsonRecord(row["custom_fields"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  };
}
