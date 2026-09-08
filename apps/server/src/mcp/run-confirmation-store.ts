import { type OpenEngageDatabase } from "@openengage/database/client";
import { IdempotencyRepository } from "@openengage/database/platform";
import { automationsContract } from "@openengage/orpc";

import type { McpWorkspaceContext } from "./types";

const payloadSchema = automationsContract.startRun["~orpc"].inputSchema!;

export async function createAutomationRunConfirmation(
  database: OpenEngageDatabase,
  workspace: McpWorkspaceContext,
  id: string,
  versionId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await new IdempotencyRepository(database).store(
    workspace.workspaceId,
    confirmationScope(workspace.apiKeyId),
    token,
    JSON.stringify(payloadSchema.parse({ id, versionId, requestId: token })),
    expiresAt,
  );
  return { token, expiresAt };
}

export async function consumeAutomationRunConfirmation(
  database: OpenEngageDatabase,
  workspace: McpWorkspaceContext,
  token: string,
) {
  const payload = await new IdempotencyRepository(database).consume(
    workspace.workspaceId,
    confirmationScope(workspace.apiKeyId),
    token,
    new Date().toISOString(),
  );
  if (!payload) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function confirmationScope(apiKeyId: string): string {
  return `mcp:automation-run:${apiKeyId}`;
}
