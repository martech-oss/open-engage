import type { WebhookEndpointRow } from "@openengage/core/workspaces";
import { type OpenEngageDatabase, WorkspaceSettingsRepository } from "@openengage/database";

import { assertSafeWebhookUrl } from "../channels";
import { encryptCredentials } from "../platform/crypto";
import { randomString } from "../platform/crypto";

export async function listWebhookEndpoints(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<WebhookEndpointRow[]> {
  return new WorkspaceSettingsRepository(database, { workspaceId }).listWebhookEndpoints();
}

export type WebhookEndpointCreateOutcome =
  | { kind: "unsafe_url" }
  | { kind: "created"; id: string; signingSecret: string };

export async function createWebhookEndpoint(
  database: OpenEngageDatabase,
  encryptionKey: string,
  workspaceId: string,
  input: { name: string; url: string; eventTypes: string[] },
): Promise<WebhookEndpointCreateOutcome> {
  try {
    assertSafeWebhookUrl(input.url);
  } catch {
    return { kind: "unsafe_url" };
  }
  const secret = randomString(40);
  const encryptedSecret = await encryptCredentials(encryptionKey, { secret });
  const { id } = await new WorkspaceSettingsRepository(database, {
    workspaceId,
  }).createWebhookEndpoint({
    name: input.name,
    url: input.url,
    encryptedSecret,
    eventTypes: input.eventTypes,
  });
  return { kind: "created", id, signingSecret: secret };
}
