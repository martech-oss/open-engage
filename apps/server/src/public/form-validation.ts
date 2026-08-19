import * as z from "zod";

import { selectPublicFormFields } from "./templates";

const SYSTEM_FIELDS = new Set([
  "_website",
  "idempotencyKey",
  "turnstileToken",
  "cf-turnstile-response",
  "oe_v",
]);

export interface PublicFormValidationIssue {
  field: string;
  reason: "undeclared" | "required" | "invalid";
}

export function validatePublicFormBody(
  definition: Record<string, unknown>,
  answered: ReadonlySet<string>,
  body: Record<string, unknown>,
): PublicFormValidationIssue[] {
  const fields = selectPublicFormFields(definition, answered);
  const declared = new Map(
    fields.map((field) => [field.kind === "custom" ? `custom:${field.key}` : field.key, field]),
  );
  const issues: PublicFormValidationIssue[] = [];

  for (const name of Object.keys(body)) {
    if (!SYSTEM_FIELDS.has(name) && !declared.has(name)) {
      issues.push({ field: name, reason: "undeclared" });
    }
  }
  for (const [name, field] of declared) {
    const value = body[name];
    if (isEmpty(value)) {
      if (field.required) issues.push({ field: name, reason: "required" });
      continue;
    }
    if (!valueMatchesType(value, field.type, field.options)) {
      issues.push({ field: name, reason: "invalid" });
    }
  }
  return issues;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function valueMatchesType(value: unknown, type: string, options: string[]): boolean {
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
  }
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (type === "email") return z.email().safeParse(text).success;
  if (type === "url") return z.url().safeParse(text).success;
  if (type === "date") return isCalendarDate(text);
  if (type === "select") return options.includes(value);
  return type === "text" || type === "textarea" || type === "tel";
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
