import { and, eq, isNull, lte, or } from "drizzle-orm";

import { contactEventOutbox } from "../contacts/schema";

export function isContactEmailConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed:\s*contacts\.workspace_id,\s*contacts\.email/i.test(message);
}

export function dueContactEventWork(now: string) {
  return or(
    and(
      eq(contactEventOutbox.status, "pending"),
      or(isNull(contactEventOutbox.nextAttemptAt), lte(contactEventOutbox.nextAttemptAt, now)),
    ),
    and(eq(contactEventOutbox.status, "processing"), lte(contactEventOutbox.leaseExpiresAt, now)),
  );
}
