import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  DeliveryRecoveryRepository,
  MessagingDeliveryWriteRepository,
  uuidv7,
} from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { processCloudflareEmailEvent } from "../src/messaging/cloudflare-events";
import { seedWorkspace } from "./factory";

const kinds = ["delivered", "deferred", "bounced", "failed", "rejected", "complained"] as const;

describe("Cloudflare Email Sending events", () => {
  it("records all six lifecycle events and applies terminal states and suppressions", async () => {
    const { workspaceId } = await seedWorkspace(env.DB);
    const contacts = new ContactRepository(env.DB, {
      workspaceId,
      userId: "event-owner",
      role: "owner",
    });
    const repository = new MessagingDeliveryWriteRepository(env.DB);
    const recovery = new DeliveryRecoveryRepository(env.DB);

    for (const kind of kinds) {
      const contact = await contacts.createContact({
        email: `${kind}@example.com`,
        customFields: {},
      });
      const deliveryId = uuidv7();
      const providerMessageId = `cf-${kind}`;
      await repository.insertQueuedDelivery({
        id: deliveryId,
        workspaceId,
        contactId: contact.id,
        enrollmentId: null,
        channel: "email",
        purpose: "transactional",
        provider: "cloudflare",
        recipient: contact.email,
        idempotencyKey: `event-${kind}`,
        payload: JSON.stringify({
          kind: "email",
          idempotencyKey: `event-${kind}`,
          workspaceId,
          deliveryId,
          purpose: "transactional",
          to: contact.email,
          from: { email: "sender@example.com" },
          subject: "Lifecycle fixture",
          html: "<p>Fixture</p>",
          text: "Fixture",
        }),
      });
      const claim = await recovery.claimDelivery(deliveryId);
      expect(claim).not.toBeNull();
      await recovery.markAccepted({
        deliveryId,
        leaseId: claim?.leaseId ?? "missing-lease",
        providerMessageId,
        acceptedAt: "2026-08-05T00:00:00.000Z",
      });

      const event = emailEvent(kind, providerMessageId, `event-id-${kind}`);
      await processCloudflareEmailEvent(event, env as RuntimeEnv);
      const expectedStatus = {
        delivered: "delivered",
        deferred: "accepted",
        bounced: "failed",
        failed: "failed",
        rejected: "failed",
        complained: "accepted",
      }[kind];
      await expect(deliveryStatus(deliveryId)).resolves.toBe(expectedStatus);

      const stored = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ? AND type = ?",
      )
        .bind(deliveryId, kind)
        .first<{ count: number }>();
      expect(stored?.count).toBe(1);
      const expectedSuppression =
        kind === "bounced"
          ? "bounce"
          : kind === "complained"
            ? "complaint"
            : kind === "rejected"
              ? "provider"
              : null;
      const suppression = await env.DB.prepare(
        "SELECT reason FROM suppressions WHERE workspace_id = ? AND email = ?",
      )
        .bind(workspaceId, contact.email)
        .first<{ reason: string }>();
      expect(suppression?.reason ?? null).toBe(expectedSuppression);

      await processCloudflareEmailEvent(event, env as RuntimeEnv);
      const duplicateCount = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ? AND type = ?",
      )
        .bind(deliveryId, kind)
        .first<{ count: number }>();
      expect(duplicateCount?.count).toBe(1);
    }
  });

  it("ignores events whose message ID does not belong to a delivery", async () => {
    await processCloudflareEmailEvent(
      emailEvent("delivered", "unknown-message", "unknown-event"),
      env as RuntimeEnv,
    );
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM delivery_events WHERE provider_event_id = ?",
    )
      .bind("unknown-event")
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});

function emailEvent(
  kind: (typeof kinds)[number],
  messageId: string,
  eventId: string,
): Record<string, unknown> {
  return {
    type: `cf.email.sending.message.${kind}`,
    source: { type: "email.sending", domain: "example.com" },
    payload: {
      eventId,
      messageId,
      recipient: `${kind}@example.com`,
      ...(kind === "rejected" ? { rejection: { reason: "suppressed" } } : {}),
    },
    metadata: { eventTimestamp: "2026-08-05T00:01:00.000Z" },
  };
}

async function deliveryStatus(deliveryId: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM deliveries WHERE id = ?")
    .bind(deliveryId)
    .first<{ status: string }>();
  return row?.status;
}
