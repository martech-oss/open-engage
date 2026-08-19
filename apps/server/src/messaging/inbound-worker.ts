import PostalMime from "postal-mime";

import { createDatabase } from "@openengage/database/client";
import { MessagingWorkerRepository } from "@openengage/database/messaging";
import { uuidv7 } from "@openengage/database/shared";

import { processPendingPublicFormEvent } from "../contacts/event-service";
import type { RuntimeEnv } from "../env";
import { verifySignedToken } from "../platform/crypto";
import { sanitizeFilename } from "../platform/values";

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
  const repository = new MessagingWorkerRepository(database);
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
    providerEventId: parsed.messageId ?? `reply:${inboundId}`,
    deliveryEventMetadata: JSON.stringify({ inboundId, subject: parsed.subject ?? "" }),
    contactEventId,
    contactEventProperties: JSON.stringify({ inboundId }),
    receivedAt,
  });
  await processPendingPublicFormEvent(database, contactEventId, env.JOBS_QUEUE);
}
