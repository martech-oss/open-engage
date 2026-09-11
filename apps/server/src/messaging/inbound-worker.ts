import PostalMime from "postal-mime";

import { createDatabase } from "@openengage/database/client";
import { MessagingInboundReplyRepository } from "@openengage/database/messaging";
import { uuidv7 } from "@openengage/database/shared";

import type { RuntimeEnv } from "../env";
import { sha256Hex, verifySignedToken } from "../platform/crypto";
import { sanitizeFilename } from "../platform/values";
import { processPendingPublicFormEvent } from "../runtime/contact-event-service";

const maximumInboundSize = 5 * 1024 * 1024;

export async function email(message: ForwardableEmailMessage, env: RuntimeEnv): Promise<void> {
  if (message.rawSize > maximumInboundSize) {
    message.setReject("Message exceeds OpenEngage's 5 MB inbound limit");
    return;
  }
  const localPart = message.to.split("@")[0] ?? "";
  if (!localPart.startsWith("r+")) {
    message.setReject("Unknown reply address");
    return;
  }
  const payload = await verifySignedToken(env.TRACKING_SIGNING_SECRET, localPart.slice(2), "reply");
  if (!payload?.contactId) {
    message.setReject("Reply address is invalid or expired");
    return;
  }
  const database = createDatabase(env.DB);
  const repository = new MessagingInboundReplyRepository(database);
  const delivery = await repository.findReplyDelivery(
    payload.workspaceId,
    payload.resourceId,
    payload.contactId,
  );
  if (!delivery) {
    message.setReject("Reply destination no longer exists");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const inboundId = uuidv7();
  const receivedAt = new Date().toISOString();
  const attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    r2Key: string;
  }> = [];
  for (const [index, attachment] of parsed.attachments.entries()) {
    const filename = sanitizeFilename(attachment.filename ?? `attachment-${index + 1}`);
    const content =
      typeof attachment.content === "string"
        ? new TextEncoder().encode(attachment.content)
        : attachment.content;
    const r2Key = `${payload.workspaceId}/inbound/${inboundId}/${index}-${filename}`;
    await env.ASSETS_BUCKET.put(r2Key, content, {
      httpMetadata: {
        contentType: attachment.mimeType ?? "application/octet-stream",
      },
      customMetadata: { inboundId },
    });
    attachments.push({
      filename,
      contentType: attachment.mimeType ?? "application/octet-stream",
      size: content.byteLength,
      r2Key,
    });
  }
  const eventId = uuidv7();
  const contactEventId = uuidv7();
  const providerEventId = await inboundReplyProviderEventId({
    deliveryId: delivery.id,
    envelopeSender: message.from,
    rawMessageId: parsed.messageId ?? null,
    fallbackId: inboundId,
  });
  await repository.recordInboundReply({
    workspaceId: payload.workspaceId,
    contactId: payload.contactId,
    deliveryId: delivery.id,
    inbound: {
      id: inboundId,
      messageId: parsed.messageId ?? null,
      sender: message.from,
      recipient: message.to,
      subject: parsed.subject?.slice(0, 998) ?? null,
      textBody: parsed.text?.slice(0, 1_000_000) ?? null,
      htmlBody: parsed.html?.slice(0, 1_000_000) ?? null,
      attachmentManifest: JSON.stringify(attachments),
    },
    deliveryEventId: eventId,
    providerEventId,
    deliveryEventMetadata: JSON.stringify({ inboundId, subject: parsed.subject ?? "" }),
    contactEventId,
    contactEventProperties: JSON.stringify({ inboundId }),
    receivedAt,
  });
  await processPendingPublicFormEvent(database, contactEventId, env.JOBS_QUEUE);
}

async function inboundReplyProviderEventId(input: {
  deliveryId: string;
  envelopeSender: string;
  rawMessageId: string | null;
  fallbackId: string;
}): Promise<string> {
  const messageId = input.rawMessageId?.trim();
  if (!messageId) {
    // Without a provider identity there is no stable dedupe key. Retain the
    // safe per-receipt behavior so unrelated Message-ID-less mail never folds.
    return `inbound-reply:v1:missing:${input.fallbackId}`;
  }
  const identity = JSON.stringify([
    "inbound-reply:v1",
    input.deliveryId,
    input.envelopeSender.trim().toLowerCase(),
    messageId,
  ]);
  return `inbound-reply:v1:${await sha256Hex(identity)}`;
}
