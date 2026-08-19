import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { emailDocumentV2Schema, type EmailDocumentV2 } from "@openengage/core/messaging";

import { organization } from "../auth/schema";
import { suppressions } from "../consent/schema";
import { contactEventProjectionRows } from "../contacts/event-repository";
import { contactEventOutbox, contactEventProjections, contactEvents } from "../contacts/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { webhookEndpoints } from "../workspaces/schema";
import {
  deliveries,
  deliveryEvents,
  emailTemplates,
  inboundEmails,
  messageVariables,
} from "./schema";

const publishedContentCodec = defineJsonCodec(
  emailDocumentV2Schema,
  "email_templates.published_content",
);

/**
 * Queue-worker and webhook-handler queries for the delivery pipeline.
 * Deliveries are claimed by id alone — the workspace comes from the delivery
 * row itself — so this repository is intentionally not workspace-scoped.
 */
export class MessagingWorkerRepository extends DatabaseRepository {
  /** Loads a live template for sending; archived templates are invisible. */
  public async findSendableTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<{
    id: string;
    purpose: "transactional";
    subject: string;
    content: EmailDocumentV2;
  } | null> {
    const row = await this.database.orm
      .select({
        id: emailTemplates.id,
        purpose: emailTemplates.purpose,
        subject: emailTemplates.publishedSubject,
        content: emailTemplates.publishedContent,
      })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.purpose, "transactional"),
          isNotNull(emailTemplates.publishedRevision),
        ),
      )
      .get();
    if (!row?.subject || !row.content) return null;
    return {
      id: row.id,
      purpose: "transactional",
      subject: row.subject,
      content: publishedContentCodec.decode(row.content),
    };
  }

  /** Live message variables as a key → value map, for template resolution. */
  public async readMessageVariables(workspaceId: string): Promise<Record<string, string>> {
    const rows = await this.database.orm
      .select({ key: messageVariables.key, value: messageVariables.value })
      .from(messageVariables)
      .where(
        and(eq(messageVariables.workspaceId, workspaceId), isNull(messageVariables.archivedAt)),
      )
      .orderBy(asc(messageVariables.key));
    return Object.fromEntries(rows.map((variable) => [variable.key, variable.value]));
  }

  public async readWorkspaceTemplateContext(
    workspaceId: string,
  ): Promise<{ id: string; name: string }> {
    const row = await this.database.orm
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, workspaceId))
      .get();
    return row ?? { id: workspaceId, name: "" };
  }

  public async findEnabledWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }

  public async findEnabledWebhookEndpointWithSecret(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string; encryptedSecret: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url, encryptedSecret: webhookEndpoints.encryptedSecret })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }

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
    await orm.batch([
      orm.insert(inboundEmails).values({
        id: input.inbound.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        deliveryId: input.deliveryId,
        messageId: input.inbound.messageId,
        sender: input.inbound.sender,
        recipient: input.inbound.recipient,
        subject: input.inbound.subject,
        textBody: input.inbound.textBody,
        htmlBody: input.inbound.htmlBody,
        attachmentManifest: input.inbound.attachmentManifest,
        receivedAt: input.receivedAt,
      }),
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
      orm.insert(contactEvents).values({
        id: input.contactEventId,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        type: "email_replied",
        resourceType: "delivery",
        resourceId: input.deliveryId,
        properties: input.contactEventProperties,
        occurredAt: input.receivedAt,
        createdAt: input.receivedAt,
      }),
      orm.insert(contactEventOutbox).values({
        eventId: input.contactEventId,
        workspaceId: input.workspaceId,
        status: "pending",
        createdAt: input.receivedAt,
      }),
      orm.insert(contactEventProjections).values(
        contactEventProjectionRows({
          id: input.contactEventId,
          workspaceId: input.workspaceId,
          createdAt: input.receivedAt,
        }),
      ),
    ]);
  }

  public async applyCloudflareDeliveryEvent(input: {
    providerEventId: string;
    providerMessageId: string;
    type: string;
    occurredAt: string;
    metadata: string;
    status: "delivered" | "failed" | null;
    suppressionReason: "bounce" | "complaint" | "provider" | null;
  }): Promise<boolean> {
    const delivery = await this.database.orm
      .select({
        id: deliveries.id,
        workspaceId: deliveries.workspaceId,
        contactId: deliveries.contactId,
        recipient: deliveries.recipient,
      })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.provider, "cloudflare"),
          eq(deliveries.providerMessageId, input.providerMessageId),
        ),
      )
      .get();
    if (!delivery) return false;
    const now = nowIso();
    const orm = this.database.orm;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm
        .insert(deliveryEvents)
        .values({
          id: uuidv7(),
          workspaceId: delivery.workspaceId,
          deliveryId: delivery.id,
          provider: "cloudflare",
          providerEventId: input.providerEventId,
          providerMessageId: input.providerMessageId,
          type: input.type,
          occurredAt: input.occurredAt,
          metadata: input.metadata,
          createdAt: now,
        })
        .onConflictDoNothing(),
    ];
    if (input.status) {
      statements.push(
        orm
          .update(deliveries)
          .set({ status: input.status, updatedAt: nowIso() })
          .where(eq(deliveries.id, delivery.id)),
      );
    }
    if (input.suppressionReason && (delivery.contactId || delivery.recipient)) {
      statements.push(
        orm
          .insert(suppressions)
          .values({
            id: uuidv7(),
            workspaceId: delivery.workspaceId,
            contactId: delivery.contactId,
            email: delivery.recipient,
            reason: input.suppressionReason,
            provider: "cloudflare",
            createdAt: input.occurredAt,
          })
          .onConflictDoNothing(),
      );
    }
    const results = await orm.batch(statements);
    const eventResult = results[0] as D1Result | undefined;
    return eventResult?.meta.changes === 1;
  }

  /** The contact behind a delivery, for timeline events; null when detached. */
  public async findDeliveryContactId(
    workspaceId: string,
    deliveryId: string,
  ): Promise<string | null> {
    const row = await this.database.orm
      .select({ contactId: deliveries.contactId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(deliveries.id, deliveryId),
          isNotNull(deliveries.contactId),
        ),
      )
      .get();
    return row?.contactId ?? null;
  }
}
