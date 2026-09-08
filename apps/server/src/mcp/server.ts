import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { registerAutomationExecutionTools } from "./tools/automation-execution";
import { registerAutomationTools } from "./tools/automations";
import { registerContactTools } from "./tools/contacts";
import { registerDashboardTools } from "./tools/dashboard";
import { registerProjectCloneTools } from "./tools/project-clones";
import { registerProjectVariableTools } from "./tools/project-variables";
import { registerProjectTools } from "./tools/projects";
import type { McpToolContext } from "./types";

export async function handleMcpRequest(
  request: Request,
  context: McpToolContext,
): Promise<Response> {
  const server = new McpServer({ name: "openengage", version: "0.1.0" });
  registerContactTools(server, context);
  registerDashboardTools(server, context);
  registerAutomationTools(server, context);
  registerProjectTools(server, context);
  registerProjectVariableTools(server, context);
  registerProjectCloneTools(server, context);
  registerAutomationExecutionTools(server, context);

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
