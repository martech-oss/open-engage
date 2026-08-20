import { describe, expect, it } from "vitest";

import { hmacHex } from "../platform/signatures";
import { OutboundWebhookAdapter, assertSafeWebhookUrl } from "./index";

describe("channel policy", () => {
  it("blocks private webhook targets", () => {
    expect(() => assertSafeWebhookUrl("http://example.com/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://127.0.0.1/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://169.254.169.254/latest")).toThrow();
    expect(
      () => new OutboundWebhookAdapter({ url: "https://hooks.example.com/a", secret: "x" }),
    ).not.toThrow();
  });

  it("signs and sends outbound webhook messages", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const adapter = new OutboundWebhookAdapter({
      url: "https://hooks.example.com/messages",
      secret: "webhook-secret",
      fetcher: async (url, init) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        requests.push({ url: requestUrl, init: init ?? {} });
        return new Response(null, { status: 202 });
      },
    });

    const result = await adapter.send({
      kind: "webhook",
      idempotencyKey: "delivery-key",
      workspaceId: "workspace-id",
      deliveryId: "delivery-id",
      payload: { contactId: "contact-id" },
    });

    expect(result.providerMessageId).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://hooks.example.com/messages");
    expect(requests[0]?.init.method).toBe("POST");
    const headers = new Headers(requests[0]?.init.headers);
    const requestBody = requests[0]?.init.body;
    if (typeof requestBody !== "string") throw new Error("Expected a string request body");
    const body = requestBody;
    const timestamp = headers.get("OpenEngage-Timestamp") ?? "";
    expect(headers.get("Idempotency-Key")).toBe("delivery-key");
    expect(headers.get("OpenEngage-Signature")).toBe(
      `v1=${await hmacHex("webhook-secret", `${timestamp}.${body}`)}`,
    );
    expect(JSON.parse(body)).toMatchObject({
      type: "message.requested",
      data: {
        workspaceId: "workspace-id",
        deliveryId: "delivery-id",
        contactId: "contact-id",
      },
    });
  });

  it("verifies and normalizes inbound webhook events", async () => {
    const secret = "webhook-secret";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({
      id: "event-id",
      type: "message.delivered",
      occurredAt: "2026-07-29T01:00:00.000Z",
      data: { workspaceId: "workspace-id", deliveryId: "delivery-id" },
    });
    const signature = await hmacHex(secret, `${timestamp}.${rawBody}`);
    const adapter = new OutboundWebhookAdapter({
      url: "https://hooks.example.com/messages",
      secret,
    });
    const request = new Request("https://example.com/api/webhooks/custom", {
      headers: {
        "OpenEngage-Event-Id": "event-id",
        "OpenEngage-Timestamp": timestamp,
        "OpenEngage-Signature": `v1=${signature}`,
      },
    });

    await expect(adapter.verifyWebhook(request, rawBody)).resolves.toEqual({
      valid: true,
      eventId: "event-id",
    });
    expect(adapter.normalizeEvents(JSON.parse(rawBody))).toEqual([
      expect.objectContaining({
        id: "event-id",
        workspaceId: "workspace-id",
        deliveryId: "delivery-id",
        provider: "webhook",
        type: "delivered",
      }),
    ]);
  });
});
