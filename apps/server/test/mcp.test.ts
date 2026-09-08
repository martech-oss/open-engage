import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

describe("Remote MCP", () => {
  it("requires a Workspace API key and validates browser origins", async () => {
    const unauthorized = await exports.default.fetch(
      new Request("http://localhost:8787/api/mcp", { method: "POST" }),
    );
    expect(unauthorized.status).toBe(401);

    const { token } = await seedWorkspaceClient(env.DB);
    const invalidOrigin = await mcpRequest(
      token,
      "tools/list",
      {},
      {
        origin: "https://attacker.example",
      },
    );
    expect(invalidOrigin.response.status).toBe(403);
  });

  it("initializes over stateless Streamable HTTP and exposes the expected tools", async () => {
    const { token } = await seedWorkspaceClient(env.DB);
    const initialized = await mcpRequest(token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "openengage-test", version: "1.0.0" },
    });
    expect(initialized.response.status).toBe(200);
    expect(initialized.payload.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "openengage", version: "0.1.0" },
    });
    expect(initialized.response.headers.get("mcp-session-id")).toBeNull();

    const listed = await mcpRequest(token, "tools/list", {});
    expect(listed.response.status).toBe(200);
    const tools = (listed.payload.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search_contacts",
        "get_dashboard",
        "list_automations",
        "get_automation_draft",
        "prepare_automation_enrollment",
        "confirm_automation_enrollment",
      ]),
    );
  });

  it("queries Workspace data and consumes enrollment confirmations once", async () => {
    const { token, client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "mcp@example.com",
      firstName: "MCP",
      customFields: {},
    });
    const automation = await client.automations.create({
      name: "MCP enrollment",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "api_event", eventName: "mcp_enrollment", reentry: "every_time" },
        },
        {
          id: "score",
          type: "action",
          position: { x: 200, y: 0 },
          config: { action: "change_score", amount: 1 },
        },
      ],
      edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
    });
    await client.automations.publish({ id: automation.id });

    const searched = await callTool(token, "search_contacts", { query: "mcp@example.com" });
    expect(JSON.parse(toolText(searched))).toMatchObject({
      items: [expect.objectContaining({ id: contact.id, email: "mcp@example.com" })],
    });

    const prepared = await callTool(token, "prepare_automation_enrollment", {
      automationId: automation.id,
      contactId: contact.id,
    });
    const confirmation = JSON.parse(toolText(prepared)) as { confirmationToken: string };
    expect(confirmation.confirmationToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const confirmed = await callTool(token, "confirm_automation_enrollment", {
      confirmationToken: confirmation.confirmationToken,
      confirmation: "CONFIRM SEND",
    });
    expect(confirmed.isError).not.toBe(true);
    expect(JSON.parse(toolText(confirmed))).toMatchObject({ enrollmentId: expect.any(String) });

    const replayed = await callTool(token, "confirm_automation_enrollment", {
      confirmationToken: confirmation.confirmationToken,
      confirmation: "CONFIRM SEND",
    });
    expect(replayed.isError).toBe(true);
    expect(toolText(replayed)).toBe("Confirmation token is invalid or expired.");

    const enrollment = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM automation_enrollments
       WHERE workspace_id = ? AND automation_id = ? AND contact_id = ?`,
    )
      .bind(workspaceId, automation.id, contact.id)
      .first<{ count: number }>();
    expect(enrollment?.count).toBe(1);
  });
});

async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const { response, payload } = await mcpRequest(token, "tools/call", {
    name,
    arguments: args,
  });
  expect(response.status).toBe(200);
  expect(payload.error).toBeUndefined();
  return payload.result as ToolCallResult;
}

async function mcpRequest(
  token: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ response: Response; payload: JsonRpcResponse }> {
  const response = await exports.default.fetch(
    new Request("http://localhost:8787/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return { response, payload: (await response.json()) as JsonRpcResponse };
}

function toolText(result: ToolCallResult): string {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("Expected MCP text content");
  return content.text;
}
