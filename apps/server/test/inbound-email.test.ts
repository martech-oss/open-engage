import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  EmailTrackingEventRepository,
  MessagingDeliveryWriteRepository,
  uuidv7,
} from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { email } from "../src/messaging/inbound-worker";
import { buildReplyAddress } from "../src/messaging/reply-address";
import { seedWorkspace } from "./factory";

describe("signed inbound email replies", () => {
  it("atomically records one reply when the same provider message arrives concurrently", async () => {
    const messageId = "<duplicate-reply@example.com>";
    const target = await seedReplyTarget({ contactEmail: "inbound@example.com" });
    const raw = rawReply(messageId, target.recipient);

    const first = emailMessage(raw, target.recipient);
    const duplicate = emailMessage(raw, target.recipient, " CUSTOMER@EXAMPLE.COM ");
    await Promise.all([
      email(first.message, env as RuntimeEnv),
      email(duplicate.message, env as RuntimeEnv),
    ]);

    expect(first.rejects).toEqual([]);
    expect(duplicate.rejects).toEqual([]);
    await expect(replyCounts(target.workspaceId)).resolves.toEqual({
      inboundEmails: 1,
      deliveryEvents: 1,
      contactEvents: 1,
      outboxRows: 1,
      projections: 6,
    });
  });

  it("treats the same Message-ID from different normalized envelope senders as distinct replies", async () => {
    const messageId = "<shared-id-different-senders@example.com>";
    const target = await seedReplyTarget({ contactEmail: "sender-scope@example.com" });
    const raw = rawReply(messageId, target.recipient);

    await email(
      emailMessage(raw, target.recipient, " First@Example.com ").message,
      env as RuntimeEnv,
    );
    await email(
      emailMessage(raw, target.recipient, "second@example.com").message,
      env as RuntimeEnv,
    );

    await expect(replyCounts(target.workspaceId)).resolves.toEqual({
      inboundEmails: 2,
      deliveryEvents: 2,
      contactEvents: 2,
      outboxRows: 2,
      projections: 12,
    });
    await expect(
      env.DB.prepare("SELECT sender FROM inbound_emails WHERE workspace_id = ? ORDER BY sender")
        .bind(target.workspaceId)
        .all<{ sender: string }>(),
    ).resolves.toMatchObject({
      results: [{ sender: " First@Example.com " }, { sender: "second@example.com" }],
    });
  });

  it("treats the same Message-ID sent to different signed delivery mailboxes as distinct replies", async () => {
    const messageId = "<shared-id-different-deliveries@example.com>";
    const first = await seedReplyTarget({ contactEmail: "first-delivery@example.com" });
    const second = await seedReplyTarget({
      workspaceId: first.workspaceId,
      contactEmail: "second-delivery@example.com",
    });

    await email(
      emailMessage(rawReply(messageId, first.recipient), first.recipient).message,
      env as RuntimeEnv,
    );
    await email(
      emailMessage(rawReply(messageId, second.recipient), second.recipient).message,
      env as RuntimeEnv,
    );

    await expect(replyCounts(first.workspaceId)).resolves.toEqual({
      inboundEmails: 2,
      deliveryEvents: 2,
      contactEvents: 2,
      outboxRows: 2,
      projections: 12,
    });
    const rows = await env.DB.prepare(
      `SELECT contact_id AS contactId, delivery_id AS deliveryId, recipient
       FROM inbound_emails WHERE workspace_id = ? ORDER BY delivery_id`,
    )
      .bind(first.workspaceId)
      .all<{ contactId: string; deliveryId: string; recipient: string }>();
    expect(rows.results).toEqual(
      [
        { contactId: first.contactId, deliveryId: first.deliveryId, recipient: first.recipient },
        {
          contactId: second.contactId,
          deliveryId: second.deliveryId,
          recipient: second.recipient,
        },
      ].sort((left, right) => left.deliveryId.localeCompare(right.deliveryId)),
    );
  });

  it("does not collide with an existing Cloudflare tracking event that uses the raw Message-ID", async () => {
    const messageId = "<shared-provider-namespace@example.com>";
    const target = await seedReplyTarget({ contactEmail: "event-scope@example.com" });
    await new EmailTrackingEventRepository(env.DB).recordTrackingEvent({
      workspaceId: target.workspaceId,
      deliveryId: target.deliveryId,
      type: "opened",
      occurredAt: "2026-08-20T00:00:00.000Z",
      providerEventId: messageId,
    });

    await email(
      emailMessage(rawReply(messageId, target.recipient), target.recipient).message,
      env as RuntimeEnv,
    );

    await expect(replyCounts(target.workspaceId)).resolves.toEqual({
      inboundEmails: 1,
      deliveryEvents: 1,
      contactEvents: 1,
      outboxRows: 1,
      projections: 6,
    });
    await expect(
      env.DB.prepare(
        "SELECT type, provider_event_id AS providerEventId FROM delivery_events WHERE workspace_id = ? ORDER BY type",
      )
        .bind(target.workspaceId)
        .all<{ type: string; providerEventId: string }>(),
    ).resolves.toMatchObject({
      results: [
        { type: "opened", providerEventId: messageId },
        { type: "replied", providerEventId: expect.stringMatching(/^inbound-reply:v1:/) },
      ],
    });
  });

  it("rolls back the reply claim when a downstream batch write fails and completes on retry", async () => {
    const messageId = "<retry-after-batch-failure@example.com>";
    const target = await seedReplyTarget({ contactEmail: "retry@example.com" });
    const raw = rawReply(messageId, target.recipient);
    await env.DB.prepare(
      `CREATE TRIGGER fail_inbound_contact_event
       BEFORE INSERT ON contact_events
       WHEN NEW.type = 'email_replied'
       BEGIN SELECT RAISE(FAIL, 'injected inbound downstream failure'); END`,
    ).run();

    await expect(
      email(emailMessage(raw, target.recipient).message, env as RuntimeEnv),
    ).rejects.toThrow("injected inbound downstream failure");
    await expect(replyCounts(target.workspaceId)).resolves.toEqual({
      inboundEmails: 0,
      deliveryEvents: 0,
      contactEvents: 0,
      outboxRows: 0,
      projections: 0,
    });
    await env.DB.prepare("DROP TRIGGER fail_inbound_contact_event").run();

    await email(emailMessage(raw, target.recipient).message, env as RuntimeEnv);

    await expect(replyCounts(target.workspaceId)).resolves.toEqual({
      inboundEmails: 1,
      deliveryEvents: 1,
      contactEvents: 1,
      outboxRows: 1,
      projections: 6,
    });
  });

  it("rejects a reply destination whose signature was changed", async () => {
    const recipient = "r+tampered@reply.example.com";
    const incoming = emailMessage("Subject: invalid\r\n\r\nBody", recipient);

    await email(incoming.message, env as RuntimeEnv);

    expect(incoming.rejects).toEqual(["Reply address is invalid or expired"]);
  });
});

function emailMessage(
  raw: string,
  recipient: string,
  sender = "customer@example.com",
): {
  message: ForwardableEmailMessage;
  rejects: string[];
} {
  const bytes = new TextEncoder().encode(raw);
  const rejects: string[] = [];
  const message = {
    from: sender,
    to: recipient,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    rawSize: bytes.byteLength,
    headers: new Headers(),
    setReject(reason: string) {
      rejects.push(reason);
    },
    forward: async () => undefined,
    reply: async () => undefined,
  } as unknown as ForwardableEmailMessage;
  return { message, rejects };
}

async function seedReplyTarget(input: { workspaceId?: string; contactEmail: string }): Promise<{
  workspaceId: string;
  contactId: string;
  deliveryId: string;
  recipient: string;
}> {
  const workspaceId = input.workspaceId ?? (await seedWorkspace(env.DB)).workspaceId;
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "inbound-owner",
    role: "owner",
  }).createContact({ email: input.contactEmail, customFields: {} });
  const deliveryId = uuidv7();
  await new MessagingDeliveryWriteRepository(env.DB).insertQueuedDelivery({
    id: deliveryId,
    workspaceId,
    contactId: contact.id,
    enrollmentId: null,
    channel: "email",
    purpose: "transactional",
    provider: "cloudflare",
    recipient: contact.email,
    idempotencyKey: `signed-inbound:${deliveryId}`,
    payload: "{}",
  });
  return {
    workspaceId,
    contactId: contact.id,
    deliveryId,
    recipient: await buildReplyAddress(env as RuntimeEnv, workspaceId, deliveryId, contact.id),
  };
}

function rawReply(messageId: string, recipient: string): string {
  return [
    `Message-ID: ${messageId}`,
    "From: Customer <customer@example.com>",
    `To: ${recipient}`,
    "Subject: Re: Signed reply",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Thanks for the update.",
  ].join("\r\n");
}

async function replyCounts(workspaceId: string): Promise<{
  inboundEmails: number;
  deliveryEvents: number;
  contactEvents: number;
  outboxRows: number;
  projections: number;
}> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM inbound_emails WHERE workspace_id = ?) AS inboundEmails,
       (SELECT COUNT(*) FROM delivery_events WHERE workspace_id = ? AND type = 'replied') AS deliveryEvents,
       (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ? AND type = 'email_replied') AS contactEvents,
       (SELECT COUNT(*) FROM contact_event_outbox WHERE workspace_id = ?) AS outboxRows,
       (SELECT COUNT(*) FROM contact_event_projections WHERE workspace_id = ?) AS projections`,
  )
    .bind(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId)
    .first<{
      inboundEmails: number;
      deliveryEvents: number;
      contactEvents: number;
      outboxRows: number;
      projections: number;
    }>();
  if (!row) throw new Error("reply counts were not returned");
  return row;
}
