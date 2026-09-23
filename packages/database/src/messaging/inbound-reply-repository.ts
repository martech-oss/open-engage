import { and, eq, exists, sql } from "drizzle-orm";

import { contactEventStatements } from "../contacts/event-repository";
import { DatabaseRepository } from "../shared/repository-base";
import { deliveries, deliveryEvents, inboundEmails } from "./schema";

/** Resolves and atomically persists signed inbound replies. */
export class MessagingInboundReplyRepository extends DatabaseRepository {
  /** Resolves the delivery a signed reply address points at, if it still exists. */
  public async findReplyDelivery(
    workspaceId: string,
    deliveryId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(deliveries.id, deliveryId),
          eq(deliveries.contactId, contactId),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Atomically (one D1 batch) stores an inbound reply: the raw email, the
   * deduplicated `replied` delivery event, and the contact timeline event.
   */
  public async recordInboundReply(input: {
    workspaceId: string;
    contactId: string;
    deliveryId: string;
    inbound: {
      id: string;
      messageId: string | null;
      sender: string;
      recipient: string;
      subject: string | null;
      textBody: string | null;
      htmlBody: string | null;
      attachmentManifest: string;
    };
    deliveryEventId: string;
    providerEventId: string;
    deliveryEventMetadata: string;
    contactEventId: string;
    contactEventProperties: Record<string, unknown>;
    receivedAt: string;
  }): Promise<void> {
    const orm = this.database.orm;
    const winningClaim = orm
      .select({ id: deliveryEvents.id })
      .from(deliveryEvents)
      .where(
        and(
          eq(deliveryEvents.id, input.deliveryEventId),
          eq(deliveryEvents.workspaceId, input.workspaceId),
          eq(deliveryEvents.deliveryId, input.deliveryId),
          eq(deliveryEvents.provider, "cloudflare"),
          eq(deliveryEvents.providerEventId, input.providerEventId),
          eq(deliveryEvents.type, "replied"),
        ),
      )
      .limit(1);
    const ownsClaim = exists(winningClaim);
    await orm.batch([
      orm
        .insert(deliveryEvents)
        .values({
          id: input.deliveryEventId,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          provider: "cloudflare",
          providerEventId: input.providerEventId,
          type: "replied",
          occurredAt: input.receivedAt,
          metadata: input.deliveryEventMetadata,
          createdAt: input.receivedAt,
        })
        .onConflictDoNothing(),
      orm.insert(inboundEmails).select(
        sql`SELECT
          ${input.inbound.id}, ${input.workspaceId}, ${input.contactId}, ${input.deliveryId},
          ${input.inbound.messageId}, ${input.inbound.sender}, ${input.inbound.recipient},
          ${input.inbound.subject}, ${input.inbound.textBody}, ${input.inbound.htmlBody},
          ${input.inbound.attachmentManifest}, ${input.receivedAt}
        WHERE ${ownsClaim}`,
      ),
      ...contactEventStatements(
        orm,
        {
          id: input.contactEventId,
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          type: "email_replied",
          resourceType: "delivery",
          resourceId: input.deliveryId,
          properties: input.contactEventProperties,
          occurredAt: input.receivedAt,
          createdAt: input.receivedAt,
        },
        { when: ownsClaim },
      ),
    ]);
  }
}
