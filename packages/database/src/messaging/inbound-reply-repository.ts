import { and, eq, notExists, sql } from "drizzle-orm";

import { contactEventProjectionRows } from "../contacts/event-repository";
import { contactEventOutbox, contactEventProjections, contactEvents } from "../contacts/schema";
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
    contactEventProperties: string;
    receivedAt: string;
  }): Promise<void> {
    const orm = this.database.orm;
    const existingReply = orm
      .select({ id: deliveryEvents.id })
      .from(deliveryEvents)
      .where(
        and(
          eq(deliveryEvents.workspaceId, input.workspaceId),
          eq(deliveryEvents.provider, "cloudflare"),
          eq(deliveryEvents.providerEventId, input.providerEventId),
        ),
      )
      .limit(1);
    const newReply = notExists(existingReply);
    const projectionRows = contactEventProjectionRows({
      id: input.contactEventId,
      workspaceId: input.workspaceId,
      createdAt: input.receivedAt,
    });
    await orm.batch([
      orm.insert(inboundEmails).select(
        sql`SELECT
          ${input.inbound.id}, ${input.workspaceId}, ${input.contactId}, ${input.deliveryId},
          ${input.inbound.messageId}, ${input.inbound.sender}, ${input.inbound.recipient},
          ${input.inbound.subject}, ${input.inbound.textBody}, ${input.inbound.htmlBody},
          ${input.inbound.attachmentManifest}, ${input.receivedAt}
        WHERE ${newReply}`,
      ),
      orm.insert(contactEvents).select(
        sql`SELECT
          ${input.contactEventId}, ${input.workspaceId}, ${input.contactId}, NULL,
          'email_replied', 'delivery', ${input.deliveryId}, ${input.contactEventProperties},
          ${input.receivedAt}, NULL, ${input.receivedAt}
        WHERE ${newReply}`,
      ),
      orm.insert(contactEventOutbox).select(
        sql`SELECT
          ${input.contactEventId}, ${input.workspaceId}, 'pending', 0, NULL,
          NULL, NULL, NULL, ${input.receivedAt}, NULL
        WHERE ${newReply}`,
      ),
      ...projectionRows.map((row) =>
        orm.insert(contactEventProjections).select(
          sql`SELECT
            ${row.eventId}, ${row.workspaceId}, ${row.projection}, ${row.status},
            ${row.createdAt}, ${null}
          WHERE ${newReply}`,
        ),
      ),
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
    ]);
  }
}
