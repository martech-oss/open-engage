import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { projectsContract } from "@openengage/orpc";

import { registerRpcTool } from "../rpc-tool";
import type { McpToolContext } from "../types";

export function registerProjectCloneTools(server: McpServer, context: McpToolContext): void {
  const api = context.rpc.projects;
  const contract = projectsContract;
  const read = { readOnly: true };

  registerRpcTool(
    server,
    "preview_project_clone",
    "Create a persisted clone preview fixing source versions, copied resources, shared references and destination options. Returns the job id required to start.",
    contract.clonePreview["~orpc"].inputSchema,
    api.clonePreview,
  );
  registerRpcTool(
    server,
    "start_project_clone",
    "Queue the frozen clone preview using its jobId and an idempotent requestKey. Poll get_project_clone_progress for completion; copied resources begin as drafts.",
    contract.cloneStart["~orpc"].inputSchema,
    api.cloneStart,
    { idempotent: true },
  );
  registerRpcTool(
    server,
    "get_project_clone",
    "Read clone status, resource mapping, progress and any failure.",
    contract.cloneGet["~orpc"].inputSchema,
    api.cloneGet,
    read,
  );
  registerRpcTool(
    server,
    "get_project_clone_progress",
    "Read lightweight clone progress and failure information. Use get_project_clone only for the frozen resource mapping and options.",
    contract.cloneProgress["~orpc"].inputSchema,
    api.cloneProgress,
    read,
  );
  registerRpcTool(
    server,
    "retry_project_clone",
    "Retry a failed clone job into the same destination, preserving its frozen preview.",
    contract.cloneRetry["~orpc"].inputSchema,
    api.cloneRetry,
  );
  registerRpcTool(
    server,
    "list_project_clones",
    "Read a page of clone history excluding previews (default 20, max 100). Pass nextCursor as cursor for the next page. Returns summaries without frozen resource data.",
    contract.cloneList["~orpc"].inputSchema,
    api.cloneList,
    read,
  );
}
