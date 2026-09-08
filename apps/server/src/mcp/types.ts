import type { RouterClient } from "@orpc/server";

import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import type { orpcRouter } from "../orpc/router";

export type McpWorkspaceContext = WorkspaceContext & { apiKeyId: string };

export interface McpToolContext {
  database: OpenEngageDatabase;
  workspace: McpWorkspaceContext;
  rpc: RouterClient<typeof orpcRouter>;
}
