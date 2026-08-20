import { and, eq, sql } from "drizzle-orm";

import type { AutomationActionAuthority } from "../automations/action-authority";
import { automationJobs } from "../automations/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { deliveries } from "./schema";

/** Writes delivery queue records while preserving idempotency. */
export class MessagingDeliveryWriteRepository extends DatabaseRepository {
  /**
   * Enqueues one delivery, skipping the insert when the idempotency key was
   * already used. Returns whether a row was actually written.
   */
  public async insertQueuedDelivery(
    input: {
      id: string;
      workspaceId: string;
      contactId: string | null;
      enrollmentId: string | null;
      channel: "email" | "webhook";
      purpose: "marketing" | "transactional";
      provider: "cloudflare" | "webhook";
      recipient: string;
      topicId?: string | null;
      templateId?: string | null;
      idempotencyKey: string;
      payload: string;
    },
    authority?: AutomationActionAuthority,
  ): Promise<boolean> {
    const now = nowIso();
    const orm = this.database.orm;
    const insert = orm.insert(deliveries);
    const result = authority
      ? await insert
          .select(
            orm
              .select({
                id: sql<string>`${input.id}`.as("id"),
                workspaceId: automationJobs.workspaceId,
                contactId: automationJobs.contactId,
                enrollmentId: automationJobs.enrollmentId,
                channel: sql<"email" | "webhook">`${input.channel}`.as("channel"),
                purpose: sql<"marketing" | "transactional">`${input.purpose}`.as("purpose"),
                provider: sql<"cloudflare" | "webhook">`${input.provider}`.as("provider"),
                recipient: sql<string>`${input.recipient}`.as("recipient"),
                topicId: sql<string | null>`${input.topicId ?? null}`.as("topic_id"),
                templateId: sql<string | null>`${input.templateId ?? null}`.as("template_id"),
                idempotencyKey: sql<string>`${input.idempotencyKey}`.as("idempotency_key"),
                payload: sql<string>`${input.payload}`.as("payload"),
                status: sql<"queued">`'queued'`.as("status"),
                providerMessageId: sql<string | null>`NULL`.as("provider_message_id"),
                attempts: sql<number>`0`.as("attempts"),
                nextAttemptAt: sql<string | null>`NULL`.as("next_attempt_at"),
                leaseId: sql<string | null>`NULL`.as("lease_id"),
                leaseExpiresAt: sql<string | null>`NULL`.as("lease_expires_at"),
                lastError: sql<string | null>`NULL`.as("last_error"),
                createdAt: sql<string>`${now}`.as("created_at"),
                updatedAt: sql<string>`${now}`.as("updated_at"),
              })
              .from(automationJobs)
              .where(
                and(
                  eq(automationJobs.id, authority.jobId),
                  eq(automationJobs.workspaceId, authority.workspaceId),
                  eq(automationJobs.status, "running"),
                  eq(automationJobs.leaseId, authority.leaseId),
                ),
              ),
          )
          .onConflictDoNothing()
      : await insert
          .values({
            id: input.id,
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            enrollmentId: input.enrollmentId,
            channel: input.channel,
            purpose: input.purpose,
            provider: input.provider,
            recipient: input.recipient,
            topicId: input.topicId ?? null,
            templateId: input.templateId ?? null,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            status: "queued",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
    return changedExactlyOne(result);
  }
}
