import { isSegmentOperatorAllowed } from "./fields.js";
import type { SegmentCondition, SegmentFilter } from "./schema.js";

export interface CompiledSegment {
  sql: string;
  params: Array<string | number | null>;
}

const contactColumns: Partial<Record<SegmentCondition["field"], string>> = {
  owner_user_id: "c.owner_user_id",
  lifecycle_stage: "c.lifecycle_stage",
  email: "c.email",
  first_name: "c.first_name",
  last_name: "c.last_name",
  phone: "c.phone",
  external_id: "c.external_id",
  stage: "c.stage",
  score: "c.score",
  grade_points: "c.grade_points",
  status: "c.status",
  created_at: "c.created_at",
  updated_at: "c.updated_at",
};

export function compileSegmentFilter(
  workspaceId: string,
  filter: SegmentFilter,
  extensions: SegmentCompilerExtensions = {},
): CompiledSegment {
  const params: Array<string | number | null> = [workspaceId];
  const expression = compileNode(filter, params, undefined, extensions);
  return {
    sql: `SELECT c.* FROM contacts c WHERE c.workspace_id = ? AND (${expression})`,
    params,
  };
}

type Relation = "company" | "deal" | "event" | "project_member";
export type SegmentCompilerExtensions = Partial<
  Record<
    Relation,
    {
      query: string;
      columns: Record<string, string>;
      qualifier?: (
        condition: SegmentCondition,
        params: Array<string | number | null>,
      ) => string | undefined;
    }
  >
>;
const relatedColumns: Record<string, [Relation, string]> = {
  company_name: ["company", "co.name"],
  company_custom_field: ["company", "co.custom_fields"],
  deal_status: ["deal", "d.status"],
  deal_stage_id: ["deal", "d.stage_id"],
  deal_owner_user_id: ["deal", "d.owner_user_id"],
  deal_value: ["deal", "d.value"],
  event_type: ["event", "ce.type"],
  event_resource_type: ["event", "ce.resource_type"],
  event_resource_id: ["event", "ce.resource_id"],
  event_occurred_at: ["event", "ce.occurred_at"],
  event_age_minutes: ["event", "((julianday('now') - julianday(ce.occurred_at)) * 1440)"],
  event_property: ["event", "ce.properties"],
};
function relatedQuery(relation: Relation, extensions: SegmentCompilerExtensions): string {
  if (extensions[relation]) return extensions[relation]!.query;
  if (relation === "project_member")
    throw new Error("Project member filters require the database segment compiler");
  if (relation === "company")
    return "FROM company_contacts cc JOIN companies co ON co.id = cc.company_id AND co.workspace_id = c.workspace_id WHERE cc.workspace_id = c.workspace_id AND cc.contact_id = c.id";
  if (relation === "deal")
    return "FROM deals d WHERE d.workspace_id = c.workspace_id AND d.contact_id = c.id AND d.archived_at IS NULL";
  return "FROM contact_events ce WHERE ce.workspace_id = c.workspace_id AND ce.contact_id = c.id";
}
function compileNode(
  filter: SegmentFilter,
  params: Array<string | number | null>,
  scope: Relation | undefined,
  extensions: SegmentCompilerExtensions,
): string {
  if (filter.kind === "group") {
    if (scope && filter.relation)
      throw new Error("Nested explicit related scopes are not supported");
    const relation = filter.relation ?? scope;
    const expression = `(${filter.children.map((child) => compileNode(child, params, relation, extensions)).join(filter.combinator === "and" ? " AND " : " OR ")})`;
    if (filter.relation) {
      const query = relatedQuery(filter.relation, extensions);
      if (filter.minimumCount !== undefined) {
        params.push(filter.minimumCount);
        return `${filter.negated ? "NOT " : ""}((SELECT COUNT(*) ${query} AND ${expression}) >= ?)`;
      }
      return `${filter.negated ? "NOT " : ""}EXISTS (SELECT 1 ${query} AND ${expression})`;
    }
    return filter.negated ? `NOT ${expression}` : expression;
  }
  const extension = Object.entries(extensions).find(([, value]) => value.columns[filter.field]);
  const related: [Relation, string] | undefined = extension
    ? [extension[0] as Relation, extension[1].columns[filter.field]!]
    : relatedColumns[filter.field];
  if (related) {
    let column = related[1];
    if (filter.field === "company_custom_field" || filter.field === "event_property") {
      params.push(`$.${sanitizeJsonPath(filter.key ?? "")}`);
      column = `json_extract(${column}, ?)`;
    }
    // An unscoped absence condition means no related row has a value. Inside
    // an explicit relation it instead tests the nullable field of that row.
    const absent = scope !== related[0] && filter.operator === "not_exists";
    const expression = scalarExpression(
      column,
      absent ? { ...filter, operator: "exists" } : filter,
      params,
    );
    const qualifier = extension?.[1].qualifier?.(filter, params);
    const qualified = qualifier ? `(${expression} AND ${qualifier})` : expression;
    if (scope === related[0]) return qualified;
    return `${absent ? "NOT " : ""}EXISTS (SELECT 1 ${relatedQuery(related[0], extensions)} AND ${qualified})`;
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
    case "category_score":
      params.push(condition.key ?? "");
      return scalarExpression(
        "COALESCE((SELECT ccs.score FROM contact_category_scores ccs WHERE ccs.workspace_id = c.workspace_id AND ccs.contact_id = c.id AND ccs.category_id = ?), 0)",
        condition,
        params,
      );
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
  const value = condition.operator === "in" ? null : normalizeValue(condition.value);
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
