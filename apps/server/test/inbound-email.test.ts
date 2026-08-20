import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ContactRepository, MessagingWorkerRepository, uuidv7 } from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { email } from "../src/messaging/inbound-worker";
import { buildReplyAddress } from "../src/messaging/reply-address";
import { seedWorkspace } from "./factory";

describe("signed inbound email replies", () => {
  it("accepts a signed reply destination and records a duplicate provider message only once", async () => {
    const messageId = "<duplicate-reply@example.com>";
    const { workspaceId } = await seedWorkspace(env.DB);
    const contact = await new ContactRepository(env.DB, {
      workspaceId,
      userId: "inbound-owner",
      role: "owner",
    }).createContact({ email: "inbound@example.com", customFields: {} });
    const deliveryId = uuidv7();
    const repository = new MessagingWorkerRepository(env.DB);
    await repository.insertQueuedDelivery({
      id: deliveryId,
      workspaceId,
      contactId: contact.id,
      enrollmentId: null,
      channel: "email",
      purpose: "transactional",
      provider: "cloudflare",
      recipient: contact.email,
      idempotencyKey: "signed-inbound-fixture",
      payload: "{}",
    });
    const recipient = await buildReplyAddress(
      env as RuntimeEnv,
      workspaceId,
      deliveryId,
      contact.id,
    );
    const raw = [
      `Message-ID: ${messageId}`,
      "From: Customer <customer@example.com>",
      `To: ${recipient}`,
      "Subject: Re: Signed reply",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Thanks for the update.",
    ].join("\r\n");

    const first = emailMessage(raw, recipient);
    const duplicate = emailMessage(raw, recipient);
    await email(first.message, env as RuntimeEnv);
    await email(duplicate.message, env as RuntimeEnv);

    expect(first.rejects).toEqual([]);
    expect(duplicate.rejects).toEqual([]);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM inbound_emails WHERE workspace_id = ? AND message_id = ?",
      )
        .bind(workspaceId, messageId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM delivery_events WHERE workspace_id = ? AND provider_event_id = ?",
      )
        .bind(workspaceId, messageId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM contact_events WHERE workspace_id = ? AND contact_id = ? AND type = 'email_replied'",
      )
        .bind(workspaceId, contact.id)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
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
): {
  message: ForwardableEmailMessage;
  rejects: string[];
} {
  const bytes = new TextEncoder().encode(raw);
  const rejects: string[] = [];
  const message = {
    from: "customer@example.com",
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
