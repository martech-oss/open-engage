import { createRouterClient } from "@orpc/server";
import type { Hono } from "hono";

import { workspaceErrors } from "@openengage/orpc";

import { apiError, resolveWorkspaceAccess, WorkspaceAccessError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { orpcRequestContext } from "../orpc/request-context";
import { orpcRouter } from "../orpc/router";
import { handleMcpRequest } from "./server";

export function registerMcpRoutes(app: Hono<AppEnvironment>): void {
  app.all("/api/mcp", async (context) => {
    const request = context.req.raw;
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(context.env.APP_URL).origin) {
      return apiError(context, 403, "origin_mismatch", workspaceErrors.ORIGIN_MISMATCH.message);
    }
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
      return apiError(context, 401, "api_key_required", "Workspace APIキーが必要です");
    }

    try {
      const access = await resolveWorkspaceAccess({
        database: context.get("database"),
        env: context.env,
        headers: request.headers,
        method: request.method,
        executionContext: context.executionCtx,
      });
      if (access.session || !access.workspace.apiKeyId) {
        return apiError(context, 401, "api_key_required", "Workspace APIキーが必要です");
      }
      const response = await handleMcpRequest(request, {
        rpc: createRouterClient(orpcRouter, { context: orpcRequestContext(context) }),
        database: context.get("database"),
        workspace: {
          ...access.workspace,
          apiKeyId: access.workspace.apiKeyId,
        },
      });
      return context.newResponse(response.body, response);
    } catch (error) {
      if (!(error instanceof WorkspaceAccessError)) throw error;
      return apiError(context, error.status, error.code, error.message);
    }
  });
}
