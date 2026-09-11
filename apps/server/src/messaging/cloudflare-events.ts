import * as z from "zod";

import { createDatabase } from "@openengage/database/client";
import { MessagingProviderEventRepository } from "@openengage/database/messaging";

import type { RuntimeEnv } from "../env";

const eventTypeSchema = z.enum([
  "cf.email.sending.message.delivered",
  "cf.email.sending.message.deferred",
  "cf.email.sending.message.bounced",
  "cf.email.sending.message.failed",
  "cf.email.sending.message.rejected",
  "cf.email.sending.message.complained",
]);

export const cloudflareEmailEventSchema = z.object({
  type: eventTypeSchema,
  source: z.object({ type: z.literal("email.sending"), domain: z.string() }).loose(),
  payload: z
    .object({
      eventId: z.string().min(1),
      messageId: z.string().min(1),
      recipient: z.string().optional(),
      rejection: z.object({ reason: z.string().optional() }).loose().optional(),
    })
    .loose(),
  metadata: z.object({ eventTimestamp: z.string().optional() }).loose(),
});

export async function processCloudflareEmailEvent(
  payload: unknown,
  env: RuntimeEnv,
): Promise<void> {
  const event = cloudflareEmailEventSchema.parse(payload);
  const kind = event.type.replace("cf.email.sending.message.", "") as
    | "delivered"
    | "deferred"
    | "bounced"
    | "failed"
    | "rejected"
    | "complained";
  const status = kind === "delivered" ? "delivered" : isFailed(kind) ? "failed" : null;
  const suppressionReason =
    kind === "bounced"
      ? "bounce"
      : kind === "complained"
        ? "complaint"
        : kind === "rejected" && event.payload.rejection?.reason === "suppressed"
          ? "provider"
          : null;
  await new MessagingProviderEventRepository(createDatabase(env.DB)).applyCloudflareDeliveryEvent({
    providerEventId: event.payload.eventId,
    providerMessageId: event.payload.messageId,
    type: kind,
    occurredAt: event.metadata.eventTimestamp ?? new Date().toISOString(),
    metadata: JSON.stringify(event),
    status,
    suppressionReason,
  });
}

function isFailed(kind: string): boolean {
  return kind === "bounced" || kind === "failed" || kind === "rejected";
}
