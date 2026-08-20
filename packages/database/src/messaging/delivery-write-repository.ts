import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { deliveries } from "./schema";

/** Writes delivery queue records while preserving idempotency. */
export class MessagingDeliveryWriteRepository extends DatabaseRepository {
  /**
   * Enqueues one delivery, skipping the insert when the idempotency key was
   * already used. Returns whether a row was actually written.
   */
  public async insertQueuedDelivery(input: {
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
  }): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .insert(deliveries)
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
