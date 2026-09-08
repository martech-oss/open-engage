import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { projectsContract } from "@openengage/orpc";

import { registerRpcTool } from "../rpc-tool";
import type { McpToolContext } from "../types";

export function registerProjectVariableTools(server: McpServer, context: McpToolContext): void {
  const api = context.rpc.projects;
  const contract = projectsContract;
  const read = { readOnly: true };

  registerRpcTool(
    server,
    "list_project_variables",
    "Read variable definitions and effective values. Omit projectId or use null for workspace scope.",
    contract.variablesList["~orpc"].inputSchema,
    api.variablesList,
    read,
  );
  registerRpcTool(
    server,
    "save_project_variable",
    "Create or update a typed variable using expectedRevision (0 for creation). Published resources adopt changes only when republished.",
    contract.variablesSave["~orpc"].inputSchema,
    api.variablesSave,
  );
  registerRpcTool(
    server,
    "delete_project_variable",
    "Delete a variable in the selected scope using its expectedRevision.",
    contract.variablesDelete["~orpc"].inputSchema,
    api.variablesDelete,
    { destructive: true },
  );
  registerRpcTool(
    server,
    "get_project_variable_uses",
    "List resources using variables in the selected scope, optionally filtered by key.",
    contract.variablesUses["~orpc"].inputSchema,
    api.variablesUses,
    read,
  );
  registerRpcTool(
    server,
    "preview_project_variable_impact",
    "Preview the uses, value changes and republication needs for a proposed variable write or removal.",
    contract.variablesImpact["~orpc"].inputSchema,
    api.variablesImpact,
    read,
  );
}
