import type { DeliveryEvent } from "@openengage/core/shared";

import { hmacHex, timingSafeEqual } from "../platform/signatures";
import { isRecord } from "../platform/values";
import { PermanentChannelError, TransientChannelError } from "./errors";
import { isStaleTimestamp } from "./signatures";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelMessage,
  ChannelSendResult,
  WebhookVerification,
} from "./types";
import { assertSafeWebhookUrl } from "./webhook-url";

export interface WebhookAdapterOptions {
  url: string;
  secret: string;
  fetcher?: typeof fetch;
}

export class OutboundWebhookAdapter implements ChannelAdapter {
  public readonly provider = "webhook" as const;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: WebhookAdapterOptions) {
    assertSafeWebhookUrl(options.url);
    this.fetcher = options.fetcher ?? fetch;
  }

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.kind !== "webhook") {
      throw new PermanentChannelError("Webhook adapter only accepts webhook messages");
    }
    const eventId = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: eventId,
      type: "message.requested",
      occurredAt: new Date().toISOString(),
      data: {
        workspaceId: message.workspaceId,
        deliveryId: message.deliveryId,
        ...message.payload,
      },
    });
    const signature = await hmacHex(this.options.secret, `${timestamp}.${body}`);
    const response = await this.fetcher(this.options.url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "OpenEngage-Event-Id": eventId,
        "OpenEngage-Timestamp": timestamp,
        "OpenEngage-Signature": `v1=${signature}`,
        "Idempotency-Key": message.idempotencyKey,
      },
      body,
    });
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    ) {
      throw new PermanentChannelError(`Webhook rejected the event with ${response.status}`);
    }
    if (!response.ok) {
      throw new TransientChannelError(`Webhook failed with ${response.status}`);
    }
    return { providerMessageId: eventId, acceptedAt: new Date().toISOString() };
  }

  public async verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification> {
    const eventId = request.headers.get("openengage-event-id");
    const timestamp = request.headers.get("openengage-timestamp");
    const signature = request.headers.get("openengage-signature")?.replace(/^v1=/, "");
    if (!eventId || !timestamp || !signature || isStaleTimestamp(timestamp)) {
      return { valid: false };
    }
    const expected = await hmacHex(this.options.secret, `${timestamp}.${rawBody}`);
    return { valid: timingSafeEqual(signature, expected), eventId };
  }

  public normalizeEvents(payload: unknown): DeliveryEvent[] {
    if (!isRecord(payload) || !isRecord(payload["data"])) return [];
    const data = payload["data"];
    if (
      typeof payload["id"] !== "string" ||
      typeof payload["type"] !== "string" ||
      typeof data["workspaceId"] !== "string" ||
      typeof data["deliveryId"] !== "string"
    ) {
      return [];
    }
    const normalized = normalizeDeliveryType(payload["type"]);
    if (!normalized) return [];
    return [
      {
        id: payload["id"],
        workspaceId: data["workspaceId"],
        deliveryId: data["deliveryId"],
        provider: "webhook",
        type: normalized,
        occurredAt:
          typeof payload["occurredAt"] === "string"
            ? payload["occurredAt"]
            : new Date().toISOString(),
        metadata: payload,
      },
    ];
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return { healthy: true, detail: "Webhook URL and signing secret are configured" };
  }
}

function normalizeDeliveryType(value: string): DeliveryEvent["type"] | null {
  const candidate = value.replace(/^message\./, "");
  const allowed: DeliveryEvent["type"][] = [
    "accepted",
    "delivered",
    "deferred",
    "opened",
    "clicked",
    "bounced",
    "complained",
    "unsubscribed",
    "replied",
    "failed",
    "rejected",
  ];
  return allowed.includes(candidate as DeliveryEvent["type"])
    ? (candidate as DeliveryEvent["type"])
    : null;
}
