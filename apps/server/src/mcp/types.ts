import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

export type McpWorkspaceContext = WorkspaceContext & { apiKeyId: string };

export interface McpToolContext {
  database: OpenEngageDatabase;
  workspace: McpWorkspaceContext;
}
