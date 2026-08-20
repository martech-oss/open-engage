import type { ChannelMessage } from "@openengage/core/messaging";

export type { ChannelMessage };

export interface ChannelSendResult {
  providerMessageId: string;
  acceptedAt: string;
}

export interface ChannelHealth {
  healthy: boolean;
  detail: string;
}

export interface WebhookVerification {
  valid: boolean;
  eventId?: string;
}

export interface ChannelAdapter {
  readonly provider: "cloudflare" | "webhook";
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  healthCheck(): Promise<ChannelHealth>;
}
