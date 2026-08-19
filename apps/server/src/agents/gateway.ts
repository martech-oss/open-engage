import type { Context, Hono } from "hono";

import type { AgentKey } from "@openengage/core/agents";
import { AgentConversationRepository } from "@openengage/database/agents";

import { apiError, resolveSessionWorkspaceAccess, WorkspaceAccessError } from "../auth/access";
import type { AppEnvironment } from "../env";

export function registerAgentGatewayRoutes(app: Hono<AppEnvironment>): void {
  app.on(["GET", "HEAD", "POST"], "/api/agents/:agent/:conversationId", forwardAgentRequest);
  app.post("/api/agents/:agent/:conversationId/abort", forwardAgentRequest);
  app.get("/api/agents/:agent/:conversationId/attachments/:attachmentId", forwardAgentRequest);
}

async function forwardAgentRequest(context: Context<AppEnvironment>): Promise<Response> {
  const agentKey = parseAgentKey(context.req.param("agent"));
  if (!agentKey) return apiError(context, 404, "not_found", "リソースが見つかりません");

  let access;
  try {
    access = await resolveSessionWorkspaceAccess({
      database: context.get("database"),
      env: context.env,
      headers: context.req.raw.headers,
      method: context.req.method,
    });
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) throw error;
    if (error.code === "workspace_required") {
      return apiError(context, 404, "not_found", "リソースが見つかりません");
    }
    return apiError(context, error.status, error.code, error.message);
  }

  const conversation = await new AgentConversationRepository(context.get("database")).findOwner(
    context.req.param("conversationId") ?? "",
    agentKey,
  );
  if (
    !conversation ||
    conversation.workspaceId !== access.workspace.workspaceId ||
    conversation.ownerUserId !== access.session.user.id
  ) {
    return apiError(context, 404, "not_found", "リソースが見つかりません");
  }

  const headers = new Headers(context.req.raw.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("x-openengage-workspace");
  return context.env.AGENT_APP.fetch(new Request(context.req.raw, { headers }));
}

function parseAgentKey(value: string | undefined): AgentKey | null {
  return value === "hello" ? value : null;
}
