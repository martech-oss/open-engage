import {
  clampGradePoints,
  type GradingCriterion,
  SCORING_EVENT_TYPES,
  type ScoringEventType,
} from "@openengage/core/scoring";
import { type OpenEngageDatabase } from "@openengage/database/client";
import {
  ScoringEngineRepository,
  type GradingContactRow,
  type ScoringRuleMatch,
} from "@openengage/database/scoring";

import { isRecord, primitiveString } from "../platform/values";

export interface ScoringEventInput {
  id: string;
  workspaceId: string;
  contactId: string;
  type: string;
  resourceId?: string | null;
  properties?: Record<string, unknown>;
}

const SCORABLE = new Set<string>(SCORING_EVENT_TYPES);

export function isScorableEvent(type: string): type is ScoringEventType {
  return SCORABLE.has(type);
}

/**
 * Applies every enabled rule for this event type, then refreshes the grade.
 * Called from the single `recordContactEvent` funnel, so page views, form
 * submissions, email opens/clicks and redirect clicks all score without each
 * producer knowing scoring exists.
 */
export async function applyScoringForEvent(
  database: OpenEngageDatabase,
  input: ScoringEventInput,
): Promise<{ total: number; tagIds: string[] }> {
  if (!isScorableEvent(input.type)) return { total: 0, tagIds: [] };
  const repository = new ScoringEngineRepository(database);
  const rules = await repository.listEnabledRules(input.workspaceId, input.type);
  const matched = rules.filter((rule) => matchesRule(rule, input));
  if (matched.length === 0) return { total: 0, tagIds: [] };

  let total = 0;
  const tagIds = new Set<string>();
  for (const rule of matched) {
    if (rule.points !== 0) {
      total += rule.points;
    }
    if (rule.tagId) tagIds.add(rule.tagId);
  }

  await repository.applyScore({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    contactEventId: input.id,
    effects: matched.map((rule) => ({
      ruleId: rule.id,
      delta: rule.points,
      categoryId: rule.categoryId,
      tagId: rule.tagId,
    })),
    now: new Date().toISOString(),
  });
  return { total, tagIds: [...tagIds] };
}

function matchesRule(rule: ScoringRuleMatch, input: ScoringEventInput): boolean {
  if (rule.matchType === "any") return true;
  const expected = rule.matchValue?.trim();
  if (!expected) return false;
  if (rule.matchType === "resource") return input.resourceId === expected;

  const url = eventUrl(input);
  if (!url) return false;
  switch (rule.matchType) {
    case "url_exact":
      return url === expected;
    case "url_contains":
      return url.includes(expected);
    case "url_starts_with":
      return url.startsWith(expected);
    default:
      return false;
  }
}

/**
 * The site beacon puts the visited URL in `resourceId`; the redirect and click
 * routes put the destination in `properties.url`. Page Actions need whichever
 * one this event carries.
 */
function eventUrl(input: ScoringEventInput): string | null {
  const fromProperties = isRecord(input.properties) ? primitiveString(input.properties["url"]) : "";
  if (fromProperties) return fromProperties;
  return input.resourceId?.startsWith("http") ? input.resourceId : null;
}

/**
 * Recomputes the A-F grade from the profile-fit criteria. Cheap enough to run
 * inline: the criteria list is small and the contact row is already indexed.
 */
export async function recomputeContactGrade(
  database: OpenEngageDatabase,
  workspaceId: string,
  contactId: string,
): Promise<number | null> {
  const repository = new ScoringEngineRepository(database);
  const [criteria, initialContact] = await Promise.all([
    repository.listEnabledCriteria(workspaceId),
    repository.readGradingContact(workspaceId, contactId),
  ]);
  let contact = initialContact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!contact) return null;
    const snapshot = contact;
    const points = clampGradePoints(
      criteria.reduce(
        (total, criterion) =>
          matchesCriterion(criterion, snapshot) ? total + criterion.steps : total,
        0,
      ),
    );
    if (points === snapshot.gradePoints) return points;
    if (await repository.setGradePoints(workspaceId, contactId, snapshot, points)) return points;
    contact = await repository.readGradingContact(workspaceId, contactId);
  }
  throw new Error("Contact changed repeatedly while recomputing its grade");
}

function matchesCriterion(criterion: GradingCriterion, contact: GradingContactRow): boolean {
  const actual = readField(criterion, contact);
  if (criterion.operator === "exists") return actual !== null && actual !== "";
  if (criterion.operator === "not_exists") return actual === null || actual === "";
  if (actual === null) return false;
  const expected = criterion.value;

  switch (criterion.operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "starts_with":
      return actual.startsWith(expected);
    case "in":
      return expected
        .split(",")
        .map((value) => value.trim())
        .includes(actual);
    default:
      return compareNumbers(criterion.operator, actual, expected);
  }
}

function compareNumbers(operator: string, actual: string, expected: string): boolean {
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

function readField(criterion: GradingCriterion, contact: GradingContactRow): string | null {
  switch (criterion.field) {
    case "email":
      return contact.email;
    case "first_name":
      return contact.firstName;
    case "last_name":
      return contact.lastName;
    case "phone":
      return contact.phone;
    case "stage":
      return contact.stage;
    case "score":
      return String(contact.score);
    case "custom_field": {
      if (!criterion.fieldKey) return null;
      const parsed: unknown = JSON.parse(contact.customFields || "{}");
      if (!isRecord(parsed)) return null;
      const value = parsed[criterion.fieldKey];
      // Objects and arrays would stringify to "[object Object]", which no
      // operator can meaningfully compare - treat them as absent instead.
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return null;
    }
  }
}
