import * as z from "zod";

import { type OpenEngageDatabase } from "@openengage/database/client";
import { IdempotencyRepository } from "@openengage/database/platform";

const confirmationLifetimeMs = 5 * 60_000;
const confirmationPayloadSchema = z.object({
  automationId: z.string().min(1),
  contactId: z.string().min(1),
});

export type AutomationConfirmation = z.infer<typeof confirmationPayloadSchema>;

export async function createAutomationConfirmation(
  database: OpenEngageDatabase,
  workspaceId: string,
  apiKeyId: string,
  payload: AutomationConfirmation,
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + confirmationLifetimeMs).toISOString();
  await new IdempotencyRepository(database).store(
    workspaceId,
    confirmationScope(apiKeyId),
    token,
    JSON.stringify(payload),
    expiresAt,
  );
  return { token, expiresAt };
}

export async function consumeAutomationConfirmation(
  database: OpenEngageDatabase,
  workspaceId: string,
  apiKeyId: string,
  token: string,
): Promise<AutomationConfirmation | null> {
  const payload = await new IdempotencyRepository(database).consume(
    workspaceId,
    confirmationScope(apiKeyId),
    token,
    new Date().toISOString(),
  );
  if (!payload) return null;
  try {
    const parsed = confirmationPayloadSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function confirmationScope(apiKeyId: string): string {
  return `mcp:automation-enrollment:${apiKeyId}`;
}
