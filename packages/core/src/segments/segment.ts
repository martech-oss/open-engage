import { isSegmentOperatorAllowed } from "./fields.js";
import type { SegmentCondition, SegmentFilter } from "./schema.js";

export interface CompiledSegment {
  sql: string;
  params: Array<string | number | null>;
}

const contactColumns: Partial<Record<SegmentCondition["field"], string>> = {
  email: "c.email",
  first_name: "c.first_name",
  last_name: "c.last_name",
  phone: "c.phone",
  external_id: "c.external_id",
  stage: "c.stage",
  score: "c.score",
  status: "c.status",
  created_at: "c.created_at",
  updated_at: "c.updated_at",
};

export function compileSegmentFilter(workspaceId: string, filter: SegmentFilter): CompiledSegment {
  const params: Array<string | number | null> = [workspaceId];
  const expression = compileNode(filter, params);
  return {
    sql: `SELECT c.* FROM contacts c WHERE c.workspace_id = ? AND (${expression})`,
    params,
  };
}

function compileNode(filter: SegmentFilter, params: Array<string | number | null>): string {
  if (filter.kind === "group") {
    const joiner = filter.combinator === "and" ? " AND " : " OR ";
    return `(${filter.children.map((child) => compileNode(child, params)).join(joiner)})`;
  }
  return compileCondition(filter, params);
}

function compileCondition(
  condition: SegmentCondition,
  params: Array<string | number | null>,
): string {
  if (!isSegmentOperatorAllowed(condition.field, condition.operator)) {
    throw new Error(`${condition.operator} is not supported for ${condition.field}`);
  }

  const column = contactColumns[condition.field];
  if (column) return scalarExpression(column, condition, params);

  if (!condition.key && ["custom_field", "event"].includes(condition.field)) {
    throw new Error(`${condition.field} requires key`);
  }

  switch (condition.field) {
    case "tag":
      params.push(String(condition.value ?? ""));
      return `${existsPrefix(condition.operator)} EXISTS (
        SELECT 1 FROM contact_tags ct
        JOIN tags t ON t.id = ct.tag_id AND t.workspace_id = c.workspace_id
        WHERE ct.contact_id = c.id AND ct.workspace_id = c.workspace_id AND t.slug = ?
      )`;
    case "segment":
      // Scoped to source = 'static' (manually curated membership) so a
      // dynamic segment can reference "is in group X" without the
      // self-referential ambiguity of matching other dynamic segments.
      params.push(String(condition.value ?? ""));
      return `${existsPrefix(condition.operator)} EXISTS (
        SELECT 1 FROM segment_memberships sm
        JOIN segments s ON s.id = sm.segment_id AND s.workspace_id = c.workspace_id
        WHERE sm.contact_id = c.id AND sm.workspace_id = c.workspace_id
          AND s.slug = ? AND sm.source = 'static'
      )`;
    case "company":
      params.push(String(condition.value ?? ""));
      return `${existsPrefix(condition.operator)} EXISTS (
        SELECT 1 FROM company_contacts cc
        JOIN companies co ON co.id = cc.company_id AND co.workspace_id = c.workspace_id
        WHERE cc.contact_id = c.id AND cc.workspace_id = c.workspace_id AND co.name = ?
      )`;
    case "subscription":
      params.push(String(condition.value ?? ""));
      return `${existsPrefix(condition.operator)} EXISTS (
        SELECT 1 FROM contact_subscriptions cs
        JOIN subscription_topics st ON st.id = cs.topic_id AND st.workspace_id = c.workspace_id
        WHERE cs.contact_id = c.id AND cs.workspace_id = c.workspace_id
          AND st.slug = ? AND cs.status = 'subscribed'
      )`;
    case "event":
      params.push(condition.key ?? "", condition.key ?? "");
      return `${existsPrefix(condition.operator)} EXISTS (
        SELECT 1 FROM contact_events ce
        WHERE ce.contact_id = c.id AND ce.workspace_id = c.workspace_id
          AND (
            ce.type = ?
            OR (ce.type IN ('custom_event', 'webhook_event') AND ce.resource_id = ?)
          )
      )`;
    case "custom_field":
      params.push(`$.${sanitizeJsonPath(condition.key ?? "")}`);
      if (condition.operator === "exists" || condition.operator === "not_exists") {
        return `json_extract(c.custom_fields, ?) IS ${condition.operator === "exists" ? "NOT " : ""}NULL`;
      }
      return scalarExpression("json_extract(c.custom_fields, ?)", condition, params);
    default:
      throw new Error(`Unsupported segment field: ${condition.field}`);
  }
}

function scalarExpression(
  column: string,
  condition: SegmentCondition,
  params: Array<string | number | null>,
): string {
  const value = normalizeValue(condition.value);
  switch (condition.operator) {
    case "eq":
      params.push(value);
      return `${column} = ?`;
    case "neq":
      params.push(value);
      return `${column} != ?`;
    case "contains":
      params.push(`%${escapeLike(String(value ?? ""))}%`);
      return `${column} LIKE ? ESCAPE '\\'`;
    case "starts_with":
      params.push(`${escapeLike(String(value ?? ""))}%`);
      return `${column} LIKE ? ESCAPE '\\'`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      params.push(value);
      const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[condition.operator];
      return `${column} ${operator} ?`;
    }
    case "exists":
      return `${column} IS NOT NULL`;
    case "not_exists":
      return `${column} IS NULL`;
    case "in": {
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (values.length === 0) return "0 = 1";
      params.push(...values.map(normalizeValue));
      return `${column} IN (${values.map(() => "?").join(", ")})`;
    }
    default:
      return assertNever(condition.operator);
  }
}

function existsPrefix(operator: SegmentCondition["operator"]): string {
  return operator === "neq" || operator === "not_exists" ? "NOT" : "";
}

function normalizeValue(
  value: SegmentCondition["value"] | string | number,
): string | number | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error("Array value is only valid for the in operator");
}

// Mirrors packages/database/src/shared/database-utils.ts's escapeLike (core
// cannot depend on database, so this stays a local copy — keep them in sync).
function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function sanitizeJsonPath(key: string): string {
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(key)) throw new Error("Invalid custom field key");
  return key;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported segment value: ${String(value)}`);
}
